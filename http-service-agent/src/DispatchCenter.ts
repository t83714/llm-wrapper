import http2 from "node:http2";
import http from "node:http";
import composeStreamMiddleware from "./middlewares/composeStreamMiddleware.js";
import basicAuth from "./middlewares/basicAuth.js";
import matchMethodPath from "./middlewares/matchMethodPath.js";
import mustAllowPush from "./middlewares/mustAllowPush.js";
const {
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_TYPE
} = http2.constants;
import sendPushRequest from "./utils/sendPushRequest.js";
import express, { Express } from "express";
import morgan from "morgan";
import pkg from "#package.json";

interface DispatchCenterConfigOptions {
    accessKeys: string[];
    controllerServerPort: 6701;
    serviceServer: 6702;
    peerMaxConcurrentStreams: 500;
    // in milliseconds, used to keep session.
    pingInterval: 3000;
    enableServiceLogs: true;
}

const server = http2.createServer({
    peerMaxConcurrentStreams: 100
});

class DispatchCenter {
    private options: DispatchCenterConfigOptions;
    private controllerServer: http2.Http2Server | null = null;
    private controllerSessions: http2.ServerHttp2Session[] = [];
    private controllerStreams: http2.ServerHttp2Stream[] = [];

    private serviceApp: Express | null = null;
    private serviceServer: http.Server | null = null;

    constructor(options: DispatchCenterConfigOptions) {
        this.options = options;
    }

    removeSession(session: http2.ServerHttp2Session) {
        this.controllerSessions = this.controllerSessions.filter(
            (item) => item !== session
        );
    }

    removeStream(stream: http2.ServerHttp2Stream) {
        this.controllerStreams = this.controllerStreams.filter(
            (item) => item !== stream
        );
    }

    start() {
        this.cleanUp();
        this.startControllerServer();
        this.startServingApp();
    }

    startServingApp() {
        const app = express();
        this.serviceApp = app;
        if (this.options.enableServiceLogs) {
            app.use(morgan("combined"));
        }
        app.use(async(req, res) => {
            this.controllerStreams = this.controllerStreams.filter(
                (stream) => stream && !stream.closed && !stream.destroyed
            );
            if (this.controllerStreams.length) {
                res.status(503).send(
                    "remote task executor agents have not connected to the service agent yet."
                );
            }
            // randomly select one connection
            const controlStream =
                this.controllerStreams[
                    Math.floor(Math.random() * this.controllerStreams.length)
                ];

            const resStream = await sendPushRequest<http2.ServerHttp2Stream>(controlStream, {
                returnStream: true,
                method: req.method as any,
                path: req.originalUrl,
                data: req,
                contentType: req.headers["content-type"]
            });
            resStream.pipe(res);
        });
    }

    startControllerServer() {
        this.controllerServer = http2.createServer({
            peerMaxConcurrentStreams: this.options.peerMaxConcurrentStreams,
            settings: {
                enablePush: true
            }
        });

        this.controllerServer.on(
            "session",
            this.setupControllerSession.bind(this)
        );
        this.controllerServer.listen(this.options.controllerServerPort);
    }

    setupControllerSession(session: http2.ServerHttp2Session) {
        this.controllerSessions.push(session);
        session.on("close", () => {
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
        session.on(
            "stream",
            composeStreamMiddleware([
                basicAuth(this.options.accessKeys),
                matchMethodPath("POST", "/__bind"),
                mustAllowPush,
                this.setupControllerStream.bind(this)
            ])
        );
    }

    async setupControllerStream(stream: http2.ServerHttp2Stream) {
        try {
            // status code 202 indicate the request has been accepted at server
            stream.respond({ HTTP2_HEADER_STATUS: 202 }, { endStream: false });
            await this.sendAckRequest(stream);
            this.controllerStreams.push(stream);
            const timer = setInterval(() => {
                if (!stream || stream.destroyed || stream.closed) {
                    clearInterval(timer);
                    return;
                }
                this.sendAckRequest(stream).catch((err) => {
                    console.error(err);
                    this.removeStream(stream);
                    stream.destroy();
                });
            }, this.options.pingInterval);
        } catch (err) {
            console.log(`Failed to setup controller stream: ${err}`);
            stream.destroy(err as Error);
        }
    }

    async sendAckRequest(controllerStream: http2.ServerHttp2Stream) {
        try {
            // send ack request
            const resData = await sendPushRequest(controllerStream, {
                method: "POST",
                path: "/__bind",
                data: Buffer.from(
                    JSON.stringify({
                        version: pkg.version,
                        app: pkg.name,
                        type: "ack",
                        role: "server"
                    }),
                    "utf8"
                )
            });
            if (resData?.app !== pkg.name) {
                throw new Error(
                    `Invalid ack response from client: invalid 'app' field: ${resData?.app}`
                );
            }
            if (resData?.type !== "ack") {
                throw new Error(
                    `Invalid ack response from client: invalid 'type' field: ${resData?.type}`
                );
            }
            if (resData?.role !== "client") {
                throw new Error(
                    `Invalid ack response from client: invalid 'role' field: ${resData?.role}`
                );
            }
            if (resData?.version !== pkg.version) {
                console.warn(
                    `A client with a different version has connected to the controller: ${resData}`
                );
            }
        } catch (err) {
            console.log(`Failed to send ack request to the client: ${err}`);
        }
    }

    cleanUp() {
        if (this.controllerStreams.length) {
            for (const stream of this.controllerStreams) {
                if (stream && !stream.destroyed) {
                    stream.destroy();
                }
            }
            this.controllerStreams = [];
        }
        if (this.controllerSessions.length) {
            for (const session of this.controllerSessions) {
                if (session && !session.destroyed) {
                    session.destroy();
                }
            }
            this.controllerSessions = [];
        }
        if (this.controllerServer) {
            this.controllerServer.close();
            this.controllerServer = null;
        }
        if (this.serviceServer) {
            this.serviceServer.close();
            this.serviceServer.closeAllConnections();
            this.serviceServer = null;
            this.serviceApp = null;
        }
    }
}

export default DispatchCenter;
