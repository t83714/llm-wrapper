import http2 from "node:http2";
import BaseStream from "./BaseStream.js";
import DispatchServer from "./DispatchServer.js";
import pkg from "#package.json" assert { type: "json" };
import { ControlCommands } from "./utils/constants.js";

class ControllerStream extends BaseStream{
    private headers: http2.IncomingHttpHeaders;

    constructor(
        server: DispatchServer,
        stream: http2.ServerHttp2Stream,
        headers: http2.IncomingHttpHeaders,
        debug: boolean = false
    ) {
        super(server, stream, debug);
        this.headers = headers;
        this.sendServerHello();
    }

    sendServerHello(){
        this.stream.write(
            JSON.stringify({
                version: pkg.version,
                app: pkg.name,
                type: ControlCommands.hello,
                role: "server",
                time: new Date().toTimeString()
            }) + "\n"
        );
    }
}

export default ControllerStream;
