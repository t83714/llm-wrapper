import http2 from "node:http2";
import http from "node:http";
import composeStreamMiddleware, {
    NextFunction
} from "./middlewares/composeStreamMiddleware.js";
import basicAuth from "./middlewares/basicAuth.js";
import ControllerStream from "./ControllerStream.js";
const {
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_TYPE
} = http2.constants;
import express, { Express } from "express";
import morgan from "morgan";
import BaseStream from "./BaseStream.js";
import getPathOnly from "./utils/getPathOnly.js";
import { defaultPeerMaxConcurrentStreams } from "./utils/constants.js";
import fse from "fs-extra";

const DEFAULT_CONFIG = {
    accessKeys: [] as string[],
    accessKeysFile: undefined as string | undefined,
    controllerServerPort: 6701,
    serviceServerPort: 6702,
    peerMaxConcurrentStreams: defaultPeerMaxConcurrentStreams,
    // in milliseconds, used to keep session.
    pingInterval: 3000,
    enableServiceLogs: true,
    debug: false,
    // wait up to 25 seconds for existing streams to be finish
    // before force shutdown
    gracefulShutdownDeadline: 25000
};

type DispatchServerConfigOptions = Partial<typeof DEFAULT_CONFIG>;

type ControllerStreamHandler = (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders
) => BaseStream | void | Promise<void> | Promise<BaseStream>;

const createControllerStreamHandlerRegistryKey = (
    method: string,
    path: string
) => `${method.toLowerCase()}@${path.toLowerCase()}`;

class DispatchServer {
    public options: DispatchServerConfigOptions;
    private controllerServer: http2.Http2Server | null = null;
    private controllerSessions: http2.ServerHttp2Session[] = [];
    private controllerStreams: ControllerStream[] = [];

    private serviceServer: http.Server | null = null;

    private controllerStreamHandlerRegistry: {
        [key: string]: ControllerStreamHandler;
    } = {};

    constructor(options: DispatchServerConfigOptions) {
        this.options = {
            ...DEFAULT_CONFIG,
            ...options
        };
        this.registerControllerStreamHandler(
            "POST",
            "/__bind",
            (stream, headers) =>
                new ControllerStream(this, stream, headers, this.options.debug)
        );
    }

    loadAccessKeysFromFile() {
        const filePath = this.options.accessKeysFile;
        if (!filePath || !fse.existsSync(filePath)) {
            return;
        }
        const keys = fse.readJSONSync(filePath);
        if (keys?.length) {
            this.options.accessKeys = keys;
            console.log(
                `Loaded ${keys.length} access keys from '${filePath}'.`
            );
        }
    }

    registerControllerStreamHandler(
        method: string,
        path: string,
        handler: ControllerStreamHandler
    ) {
        this.controllerStreamHandlerRegistry[
            createControllerStreamHandlerRegistryKey(method, path)
        ] = handler;
    }

    deregisterControllerStreamHandler(method: string, path: string) {
        delete this.controllerStreamHandlerRegistry[
            createControllerStreamHandlerRegistryKey(method, path)
        ];
    }

    removeSession(session: http2.ServerHttp2Session) {
        this.controllerSessions = this.controllerSessions.filter(
            (item) => item !== session
        );
    }

    start() {
        if (this.controllerServer) {
            console.error("The server has already started!");
            return;
        }
        this.startControllerServer();
        this.startServingApp();
    }

    startServingApp() {
        const app = express();
        if (this.options.enableServiceLogs) {
            app.use(morgan("combined"));
        }
        app.use(express.json());
        app.use(express.text());
        app.get("/__status/liveness", (req, res) => res.send("OK"));
        app.get("/__status/readiness", (req, res) => res.send("OK"));
        app.use((req, res) => {
            const liveControllerStreams = this.controllerStreams.filter(
                (s) => !s.isClosed()
            );
            if (!liveControllerStreams.length) {
                res.status(503).send(
                    "No live controller stream available. Please try later."
                );
                return;
            }
            const pickedControllerStream =
                liveControllerStreams[
                    Math.floor(Math.random() * liveControllerStreams.length)
                ];
            pickedControllerStream
                .delegateExpressRequest(req, res)
                .catch((e) =>
                    res.status(500).send(`Failed to delegate request: ${e}`)
                );
        });
        this.serviceServer = app.listen(this.options.serviceServerPort);
    }

    startControllerServer() {
        this.printDebugInfo("starting the controlling server...");
        this.controllerServer = http2.createServer({
            peerMaxConcurrentStreams: this.options.peerMaxConcurrentStreams
        });
        this.controllerServer.on("sessionError", (err: Error) => {
            console.error(`Session error: ${err}`);
        });
        this.controllerServer.on(
            "session",
            this.handleControllerServerSessions.bind(this)
        );
        this.controllerServer.listen(this.options.controllerServerPort);
        this.printDebugInfo(
            `started the controlling server on ${this.options.controllerServerPort}`
        );
    }

    handleControllerServerSessions(session: http2.ServerHttp2Session) {
        this.printDebugInfo("A new controller session started...");
        session.on(
            "stream",
            composeStreamMiddleware([
                basicAuth(this.options.accessKeys),
                async (
                    stream: http2.ServerHttp2Stream,
                    headers: http2.IncomingHttpHeaders,
                    next: NextFunction
                ) => {
                    const requestMethod = headers[
                        HTTP2_HEADER_METHOD
                    ] as string;
                    const requestPath = headers[HTTP2_HEADER_PATH] as string;
                    const requestPathname = requestPath
                        ? getPathOnly(requestPath)
                        : "/";

                    const handler =
                        this.controllerStreamHandlerRegistry[
                            createControllerStreamHandlerRegistryKey(
                                requestMethod,
                                requestPathname
                            )
                        ];

                    if (typeof handler === "function") {
                        let result = handler(stream, headers);
                        if (result instanceof Promise) {
                            result = await result;
                        }
                        if (result instanceof ControllerStream) {
                            this.controllerStreams.push(result);
                        }
                    } else {
                        // either method or path not match, respond 404
                        stream.respond({
                            [HTTP2_HEADER_STATUS]: 404,
                            [HTTP2_HEADER_CONTENT_TYPE]:
                                "text/plain; charset=utf-8"
                        });
                        stream.end("Not found");
                    }
                }
            ])
        );

        this.controllerSessions.push(session);
        session.on("close", () => {
            this.printDebugInfo("The controller session is closing...");
            this.controllerSessions = this.controllerSessions.filter(
                (item) => item !== session
            );
            if (!session.destroyed) {
                session.destroy();
            }
        });
        session.on("error", (err: Error) => {
            console.error(`Error occured for controller session: ${err}`);
        });
        session.on("frameError", (type: number, code: number, id: number) => {
            console.error(
                `FrameError occured for controller session. type: ${type}, code: ${code}, id: ${id}`
            );
        });
        this.printDebugInfo("The controller session middleware...");

        this.printDebugInfo("The controller session setup completed.");
    }

    printDebugInfo(msg: string) {
        if (this.options.debug) {
            console.log(`DispatchServer: ${msg}`);
        }
    }

    shutdown() {
        this.printDebugInfo("start to shutdown...");
        if (this.controllerServer) {
            this.controllerServer.close();
            this.controllerServer = null;
        }
        if (this.serviceServer) {
            this.serviceServer.close();
            this.serviceServer.closeAllConnections();
            this.serviceServer = null;
        }
        if (this.controllerStreams.length) {
            for (const stream of this.controllerStreams) {
                stream.cleanUp();
            }
            this.controllerStreams = [];
        }
        if (this.controllerSessions.length) {
            for (const session of this.controllerSessions) {
                if (session) {
                    const timer = setTimeout(
                        () => session.destroy(),
                        this.options.gracefulShutdownDeadline
                    );
                    session.on("close", () => clearTimeout(timer));
                    session.close();
                }
            }
            this.controllerSessions = [];
        }
    }
}

export default DispatchServer;
