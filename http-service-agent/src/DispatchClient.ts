import http2 from "node:http2";
import { DEFAULT_USERNAME } from "./middlewares/basicAuth.js";
import pkg from "#package.json" assert { type: "json" };
import JsonlParser from "stream-json/jsonl/Parser.js";

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_CONTENT_TYPE,
    HTTP2_HEADER_AUTHORIZATION
} = http2.constants;

interface DispatchClientConfigOptions {
    accessKey?: string;
    dispatchServerBaseUrl: URL;
    peerMaxConcurrentStreams?: number;
}

class DispatchClient {
    private options: DispatchClientConfigOptions;
    private session: http2.ClientHttp2Session | null = null;
    private stream: http2.ClientHttp2Stream | null = null;

    constructor(options: DispatchClientConfigOptions) {
        if (!(options.dispatchServerBaseUrl instanceof URL)) {
            throw new Error(
                "requires dispatchServerBaseUrl to be an `URL` instance!"
            );
        }
        this.options = options;
    }

    async start() {
        this.cleanUp();
        this.session = await this.connect();
        this.stream = await this.request(this.session);

        const parser = new JsonlParser();
        const pipeline = this.stream.pipe(parser);

        pipeline.on("data", (v: any) => {
            console.log(`data received: ${JSON.stringify(v)}`);
        });

        // this.stream.on("data", (chunk: Buffer) => {
        //     console.log(chunk.toString("utf8"));
        // });
    }

    async connect() {
        const pSession = new Promise<http2.ClientHttp2Session>(
            (resolve, reject) => {
                http2.connect(
                    // path in this url will be ignored
                    this.options.dispatchServerBaseUrl,
                    {
                        settings: {
                            enablePush: false
                        },
                        ...(this.options.peerMaxConcurrentStreams
                            ? {
                                  peerMaxConcurrentStreams:
                                      this.options.peerMaxConcurrentStreams
                              }
                            : {})
                    },
                    (session, socket) => resolve(session)
                );
            }
        );
        const session = await pSession;
        session.on("error", (err) => console.error(err));
        return session;
    }

    async request(session: http2.ClientHttp2Session) {
        const basePathname = this.options.dispatchServerBaseUrl.pathname;
        const requestPath =
            basePathname === "/" ? "/__bind" : `${basePathname}/__bind`;

        const headers = {
            [HTTP2_HEADER_METHOD]: "POST",
            [HTTP2_HEADER_PATH]: requestPath,
            [HTTP2_HEADER_CONTENT_TYPE]: "application/jsonl"
        } as Record<string, string>;

        if (
            this.options.accessKey &&
            typeof this.options.accessKey === "string"
        ) {
            headers[HTTP2_HEADER_AUTHORIZATION] = `Basic ${Buffer.from(
                // when access key doesn't include username, we will add the default username.
                this.options.accessKey.indexOf(":") !== -1
                    ? this.options.accessKey
                    : `${DEFAULT_USERNAME}:${this.options.accessKey}`
            ).toString("base64")}`;
        }

        this.stream = session.request(headers, {
            endStream: false
        });
        return this.stream;
    }

    cleanUp() {
        if (this.stream) {
            this.stream?.destroy();
            this.stream = null;
        }
        if (this.session) {
            this.session?.destroy();
            this.session = null;
        }
    }
}

export default DispatchClient;
