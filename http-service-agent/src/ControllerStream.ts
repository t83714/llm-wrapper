import http2 from "node:http2";
import BaseStream from "./BaseStream.js";
import DispatchServer from "./DispatchServer.js";
import JsonlParser from "stream-json/jsonl/Parser.js";
import { ControlCommands } from "./utils/constants.js";
import createCommandData, {
    CommandDataType
} from "./utils/createCommandData.js";
import { Request, Response } from "express";
import { v4 as uuidV4 } from "uuid";
const { HTTP2_HEADER_CONTENT_TYPE } = http2.constants;

type ResponseHandlerType = (v: any) => void;

const DEFAULT_REQUEST_TIMEOUT = 3000;
const DEFAULT_PING_INTERVAL = 3500;
const DEFAULT_DELEGATE_REQUEST_TIMEOUT = 5000;

class ControllerStream extends BaseStream {
    private headers: http2.IncomingHttpHeaders;

    private responseQueue: any[] = [];
    private responseHandlerQueue: ResponseHandlerType[] = [];

    private pingTimer: NodeJS.Timer | null = null;

    constructor(
        server: DispatchServer,
        stream: http2.ServerHttp2Stream,
        headers: http2.IncomingHttpHeaders,
        debug: boolean = false
    ) {
        super(server, stream, debug);
        this.headers = headers;
        this.setupStreamParser();
        this.sendServerHello().then(() => this.setupPing());
    }

    registerResponseHandler(h: ResponseHandlerType) {
        this.responseHandlerQueue.push(h);
        return h;
    }

    removeResponseHandler(h: ResponseHandlerType) {
        this.responseHandlerQueue = this.responseHandlerQueue.filter(
            (item) => item === h
        );
    }

    processResponseQueue() {
        if (!this.responseQueue.length || !this.responseHandlerQueue.length) {
            return;
        }
        while (1) {
            const handler = this.responseHandlerQueue.pop();
            const resData = this.responseQueue.pop();
            handler!(resData);
            if (
                !this.responseQueue.length ||
                !this.responseHandlerQueue.length
            ) {
                return;
            }
        }
    }

    setupStreamParser() {
        const parser = new JsonlParser();
        const pipeline = this.stream.pipe(parser);

        pipeline.on("data", (v: any) => {
            this.responseQueue.push(v);
            this.processResponseQueue();
        });
    }

    async sendJsonRequest<T = any>(
        data: Record<string, any>,
        timeout: number = DEFAULT_REQUEST_TIMEOUT
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout | null = null;
            const handler = (data: T) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                resolve(data);
            };
            this.registerResponseHandler(handler);
            timer = setTimeout(() => {
                reject(
                    new Error(
                        `ControllerStream request failed to receive response in ${timeout}ms! Request data: ${JSON.stringify(
                            data,
                            undefined,
                            2
                        )}`
                    )
                );
                this.removeResponseHandler(handler);
                this.cleanUp();
            }, timeout);
            this.stream.write(JSON.stringify(data) + "\n");
        });
    }

    async sendServerHello() {
        const resData = await this.sendJsonRequest<CommandDataType>(
            createCommandData(ControlCommands.hello, "server")
        );
        if (resData?.role !== "client") {
            throw new Error(
                `Invalid client response for ${ControlCommands.hello} command: role should be "client"`
            );
        }
        if (resData?.type !== ControlCommands.hello) {
            throw new Error(
                `Invalid client response for ${ControlCommands.hello} command: type should be "${ControlCommands.hello}"`
            );
        }
        console.log(
            `Received connection from client: version: ${resData?.version} app: ${resData?.app} time: ${resData?.time}`
        );
    }

    setupPing() {
        this.pingTimer = setInterval(async () => {
            try {
                const resData = await this.sendJsonRequest<CommandDataType>(
                    createCommandData(ControlCommands.ping, "server")
                );
                if (resData?.role !== "client") {
                    throw new Error(
                        `Invalid client response for ${ControlCommands.ping} command: role should be "client"`
                    );
                }
                if (resData?.type !== ControlCommands.ping) {
                    throw new Error(
                        `Invalid client response for ${ControlCommands.ping} command: type should be "${ControlCommands.ping}"`
                    );
                }
            } catch (e) {
                console.error(
                    `Failed to send ping request via controller stream: ${e}`
                );
            }
        }, DEFAULT_PING_INTERVAL);
    }

    async delegateExpressRequest(req: Request, res: Response) {
        const method = req.method.toUpperCase();
        const responsePath = `/__bind/response/${uuidV4()}`;

        this.printDebugInfo(
            `Receive delegate request for: ${method} ${req.originalUrl}`
        );

        const responseStreamPromise = new Promise<
            [http2.ServerHttp2Stream, http2.IncomingHttpHeaders]
        >((resolve, reject) => {
            const timer = setTimeout(() => {
                this.server.deregisterControllerStreamHandler(
                    method,
                    responsePath
                );
                throw new Error(
                    `Request timeout after ${DEFAULT_DELEGATE_REQUEST_TIMEOUT}ms`
                );
            }, DEFAULT_DELEGATE_REQUEST_TIMEOUT);

            const handler = (
                stream: http2.ServerHttp2Stream,
                headers: http2.IncomingHttpHeaders
            ) => {
                if (timer) {
                    clearTimeout(timer);
                }
                resolve([stream, headers]);
            };

            this.server.registerControllerStreamHandler(
                method,
                responsePath,
                handler
            );
        });

        const commandData = createCommandData(
            ControlCommands.delegateRequest,
            "server",
            {
                method,
                path: req.originalUrl,
                responsePath,
                data: req?.body,
                headers: req.headers
            }
        );

        // send command data through control stream
        this.stream.write(JSON.stringify(commandData) + "\n");

        const [resStream, resHeaders] = await responseStreamPromise;

        this.printDebugInfo(
            `Received response stream for delegate request: ${method} ${req.originalUrl}`
        );

        res.status(resHeaders["delegate-status-code"] as unknown as number);
        if (resHeaders[HTTP2_HEADER_CONTENT_TYPE]) {
            res.type(
                resHeaders[HTTP2_HEADER_CONTENT_TYPE] as unknown as string
            );
        }
        resStream.pipe(res);
    }

    printDebugInfo(msg: string) {
        if (this.server.options.debug) {
            console.log(`ControllerStream: ${msg}`);
        }
    }

    isClosed(){
        return super.isClosed() || !this.pingTimer;
    }

    cleanUp() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        super.cleanUp();
    }
}

export default ControllerStream;
