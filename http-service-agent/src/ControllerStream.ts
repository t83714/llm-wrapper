import http2 from "node:http2";
import BaseStream from "./BaseStream.js";
import DispatchServer from "./DispatchServer.js";
import pkg from "#package.json" assert { type: "json" };
import JsonlParser from "stream-json/jsonl/Parser.js";
import { ControlCommands } from "./utils/constants.js";
import createCommandData, {
    CommandDataType
} from "./utils/createCommandData.js";

type ResponseHandlerType = (v: any) => void;

const DEFAULT_REQUEST_TIMEOUT = 3000;
const DEFAULT_PING_INTERVAL = 3500;

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

    cleanUp() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        super.cleanUp();
    }
}

export default ControllerStream;
