import http2 from "node:http2";
import DispatchServer from "./DispatchServer.js";

class BaseStream {
    protected stream: http2.ServerHttp2Stream;
    protected server: DispatchServer;
    protected debug: boolean;

    constructor(
        server: DispatchServer,
        stream: http2.ServerHttp2Stream,
        debug: boolean = false
    ) {
        this.stream = stream;
        this.server = server;
        this.debug = debug;
    }

    isClosed(){
        return this.stream.closed || this.stream.destroyed;
    }

    cleanUp() {
        if (this.stream.destroyed) {
            return;
        }
        if (this.stream.closed) {
            this.stream.destroy();
            return;
        }
        const timer = setTimeout(
            () => this.stream.destroy(),
            this.server.options.gracefulShutdownDeadline
        );
        this.stream.on("close", () => clearTimeout(timer));
        this.stream.close();
    }
}

export default BaseStream;