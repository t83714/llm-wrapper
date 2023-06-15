// import http2 from "node:http2";
// import http from "node:http";

// console.log(http2.constants.HTTP2_METHOD_GET);
// console.log(http.METHODS);
import DispatchServer from "./DispatchServer.js";

const server = new DispatchServer({
    accessKeys: ["12345"],
    debug: false
});

server.start();

process.on("uncaughtException", (err, origin) => {
    console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
});
