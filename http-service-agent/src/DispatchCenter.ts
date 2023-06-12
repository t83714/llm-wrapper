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
import pkg from "#package.json";

interface DispatchCenterConfigOptions {
    accessKeys: string[];
    controllerServerPort: 6701;
    serviceServer: 6702;
    peerMaxConcurrentStreams: 500;
    // in milliseconds, used to keep session.
    pingInterval: 3000;
}

const server = http2.createServer({
    peerMaxConcurrentStreams: 100
});

class DispatchCenter {
    private options: DispatchCenterConfigOptions;
    private controllerServer: http2.Http2Server | null = null;
    private controllerSession: http2.ServerHttp2Session | null = null;
    private controllerStream: http2.ServerHttp2Stream | null = null;

    private serviceServer: http.Server | null = null;

    constructor(options: DispatchCenterConfigOptions) {
        this.options = options;
    }

    start() {
        this.cleanUp();
        this.startControllerServer();
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
        this.controllerSession = session;
        session.on("close", () => {
            this.controllerSession?.destroy();
            this.controllerSession = null;
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
        this.setupControllerSessionAutoPing(session);
    }

    async setupControllerStream(stream: http2.ServerHttp2Stream) {
        try {
            // status code 202 indicate the request has been accepted at server
            stream.respond({ HTTP2_HEADER_STATUS: 202 }, { endStream: false });
            // send ack request
            const resData = await sendPushRequest(stream, {
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
                throw new Error(`Invalid ack response from client: invalid 'app' field: ${resData?.app}`);
            }
            if (resData?.type !== "ack") {
                throw new Error(`Invalid ack response from client: invalid 'type' field: ${resData?.type}`);
            }
            if (resData?.role !== "client") {
                throw new Error(`Invalid ack response from client: invalid 'role' field: ${resData?.role}`);
            }
            if (resData?.version !== pkg.version) {
                console.warn(`A client with a different version has connected to the controller: ${resData}`);
            }
        } catch (err) {
            console.log(`Failed to setup controller stream: ${err}`);
            stream.destroy(err as Error);
        }
    }

    /**
     * Keep sending ping frame to avoid controller session being timeout
     *
     * @param {http2.ServerHttp2Session} session
     * @memberof DispatchCenter
     */
    setupControllerSessionAutoPing(session: http2.ServerHttp2Session) {
        const timer = setInterval(() => {
            if (!session || session.destroyed || session.closed) {
                clearInterval(timer);
                return;
            }
            session.ping((err) => {
                if (err) {
                    console.error(`Controller session ping failed: ${err}`);
                }
            });
        }, this.options.pingInterval);
    }

    cleanUp() {
        if (this.controllerSession) {
            this.controllerSession.close();
            this.controllerSession = null;
        }
        if (this.controllerServer) {
            this.controllerServer.close();
            this.controllerServer = null;
        }
        if (this.serviceServer) {
            this.serviceServer.close();
            this.serviceServer = null;
        }
    }
}

export default DispatchCenter;
