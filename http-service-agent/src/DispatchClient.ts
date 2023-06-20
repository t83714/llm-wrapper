import http2 from "node:http2";
import { DEFAULT_USERNAME } from "./middlewares/basicAuth.js";
import JsonlParser from "stream-json/jsonl/Parser.js";
import createCommandData, {
    CommandDataType,
    DelegateRequestCommandDataType
} from "./utils/createCommandData.js";
import { ControlCommands } from "./utils/constants.js";
import { Readable } from 'node:stream';
import {
    ReadableStream,
  } from 'node:stream/web';

const {
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_CONTENT_TYPE,
    HTTP2_HEADER_AUTHORIZATION
} = http2.constants;

interface DispatchClientConfigOptions {
    accessKey?: string;
    dispatchServerBaseUrl: URL;
    targetServerBaseUrl: URL;
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
        if (!(options.targetServerBaseUrl instanceof URL)) {
            throw new Error(
                "requires targetServerBaseUrl to be an `URL` instance!"
            );
        }
        this.options = options;
    }

    async start() {
        this.cleanUp();
        this.session = await this.connect();
        this.stream = await this.requestControlStream();

        const parser = new JsonlParser();
        const pipeline = this.stream.pipe(parser);
        pipeline.on("data", this.processCommand);
    }

    sendJsonRes(data: Record<string, any>) {
        this.stream?.write(JSON.stringify(data) + "\n");
    }

    async processCommand(commandData: CommandDataType) {
        switch (commandData?.type) {
            case ControlCommands.hello:
                this.sendJsonRes(
                    createCommandData(ControlCommands.hello, "client")
                );
                break;
            case ControlCommands.ping:
                this.sendJsonRes(
                    createCommandData(ControlCommands.ping, "client")
                );
                break;
            case ControlCommands.delegateRequest:
                this.delegateRequest(
                    commandData as DelegateRequestCommandDataType
                );
                break;
            default:
                throw new Error(
                    `Invalid command type: ${
                        commandData?.type
                    } received. \nCommand data: ${JSON.stringify(
                        commandData,
                        undefined,
                        2
                    )}`
                );
        }
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

    async requestControlStream() {
        if (!this.session) {
            throw new Error(
                "Cannot request control stream before creating session."
            );
        }
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

        this.stream = this.session.request(headers, {
            endStream: false
        });
        return this.stream;
    }

    async delegateRequest(commandData: DelegateRequestCommandDataType) {
        if (!this.session) {
            throw new Error(
                "Cannot delegate requests before creating session."
            );
        }
        const targetRequestUrl = `${this.options.targetServerBaseUrl}${
            this.options.targetServerBaseUrl.pathname === "/"
                ? commandData.path.replace(/^\//, "")
                : commandData.path
        }`;

        const requestConfig: RequestInit = {
            method: commandData.method
        };
        if (commandData.data) {
            requestConfig.body = JSON.stringify(requestConfig.body);
        }
        if (commandData.headers) {
            requestConfig.headers = commandData.headers;
        }

        const res = await fetch(targetRequestUrl, requestConfig);

        const basePathname = this.options.dispatchServerBaseUrl.pathname;
        const exchangeResponseRequestPath =
            basePathname === "/"
                ? commandData.responsePath
                : `${basePathname}/${commandData.responsePath}`;

        const headers = {
            [HTTP2_HEADER_METHOD]: "POST",
            [HTTP2_HEADER_PATH]: exchangeResponseRequestPath,
            "delegate-status-code": res.status,
            "delegate-status-text": res.statusText,
            ...(res.headers.get("Content-Type")
                ? {
                      [HTTP2_HEADER_CONTENT_TYPE]:
                          res.headers.get("Content-Type")
                  }
                : {})
        } as Record<string, string>;

        if (!res.body) {
            this.session.request(headers, {
                endStream: true
            });
        } else {
            const stream = this.session.request(headers, {
                endStream: false
            });
            Readable.fromWeb(res.body as ReadableStream).pipe(stream);
        }
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
