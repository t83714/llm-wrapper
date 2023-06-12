import http2 from "node:http2";
import http from "node:http";
import composeStreamMiddleware from "./middlewares/composeStreamMiddleware.js";
import basicAuth from "./middlewares/basicAuth.js";
import matchMethodPath from "./middlewares/matchMethodPath.js";

interface DispatchCenterConfigOptions {
    accessKeys: string[];
    commandServerPort: 6701;
    serviceServer: 6702;
    peerMaxConcurrentStreams: 500;
}

const server = http2.createServer({
    peerMaxConcurrentStreams: 100
});

class DispatchCenter {
    private options: DispatchCenterConfigOptions;
    private commandServer: http2.Http2Server | null = null;
    private commandSession: http2.ServerHttp2Session | null = null;

    private serviceServer: http.Server | null = null;

    constructor(options: DispatchCenterConfigOptions) {
        this.options = options;
    }

    start() {
        this.cleanUp();
        this.startCommandServer();
    }

    startCommandServer() {
        this.commandServer = http2.createServer({
            peerMaxConcurrentStreams: this.options.peerMaxConcurrentStreams,
            settings: {
                enablePush: true
            }
        });

        this.commandServer.on("session", this.setupCommandSession.bind(this));
        this.commandServer.listen(this.options.commandServerPort);
    }

    setupCommandSession(session: http2.ServerHttp2Session) {
        this.commandSession = session;
        session.on("close", () => {
            this.commandSession?.destroy();
            this.commandSession = null;
        });
        session.on("error", (err: Error) => {
            console.error(`Error occured for command session: ${err}`);
        });
        session.on("frameError", (type: number, code: number, id: number) => {
            console.error(
                `FrameError occured for command session. type: ${type}, code: ${code}, id: ${id}`
            );
        });
        session.on(
            "stream",
            composeStreamMiddleware([
                basicAuth(this.options.accessKeys),
                matchMethodPath("put", "/__bind")
            ])
        );
    }

    cleanUp() {
        if (this.commandSession) {
            this.commandSession.close();
            this.commandSession = null;
        }
        if (this.commandServer) {
            this.commandServer.close();
            this.commandServer = null;
        }
        if (this.serviceServer) {
            this.serviceServer.close();
            this.serviceServer = null;
        }
    }
}

export default DispatchCenter;
