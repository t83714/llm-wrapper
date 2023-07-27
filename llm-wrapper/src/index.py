from flask import Flask, request, json
from transformers import AutoConfig, AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer, StoppingCriteria, StoppingCriteriaList
import torch

device = f'cuda:{torch.cuda.current_device()}' if torch.cuda.is_available() else 'cpu'

print(f'Selected LLM device is: {device}')

model_name = "nomic-ai/gpt4all-mpt"

config = AutoConfig.from_pretrained(
  model_name,
  trust_remote_code=True
)

# use the optimized triton implementation of FlashAttention, you can load the model with attn_impl='triton' and move the model to bfloat16
#config.attn_config['attn_impl'] = 'triton'
config.init_device = device
#config.max_seq_len = 2048
# update the maximum sequence length during inference to 4096
# config.max_seq_len = 3072

model = AutoModelForCausalLM.from_pretrained(
    model_name,
    config=config,
    torch_dtype=torch.bfloat16,
    #ignore_mismatched_sizes=True,
    trust_remote_code = True
)

model.eval()

tokenizer = AutoTokenizer.from_pretrained(model_name)

class CheckStop(StoppingCriteria):
    def __init__(self, stop=None):
        super().__init__()
        self.stop = stop or []
        self.matched = ""
        self.stop_ids = [tokenizer.encode(s, return_tensors='pt').to(device) for s in self.stop]
    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs):
        for i, s in enumerate(self.stop_ids):
            if torch.all((s == input_ids[0][-s.shape[1]:])).item():
                self.matched = self.stop[i]
                return True
        return False

def llm(prompt, stop=None, **kwargs):
  check_stop = CheckStop(stop)
  inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
  generation_kwargs = dict(
    inputs,
    bos_token_id = 0,
    eos_token_id = 0,
    pad_token_id = 1,
    temperature = 0.1,
    top_p=0.15,
    top_k=0, # as top_k=0, top_p will be used
    #repetition_penalty=1.1,
    stopping_criteria = StoppingCriteriaList([CheckStop(stop)]) if stop is None else None,
    max_new_tokens = 500,
    **kwargs
  )
  result = model.generate(inputs, stopping_criteria=[check_stop], **generation_kwargs)
  return result[0]["generated_text"].rstrip(check_stop.matched)

app = Flask("llm-api")

@app.route('/', methods=['POST'])
def serve_llm():
  resp = llm(**request.json)
  return json.dumps(resp)

app.run(host="0.0.0.0", port="6801")