import http2 from "node:http2";
import { StreamMiddlewareType } from "./composeStreamMiddleware.js";
const { HTTP2_HEADER_STATUS, HTTP2_HEADER_CONTENT_TYPE } = http2.constants;

const mustAllowPush: StreamMiddlewareType = (stream, headers, next) => {
    if (stream.pushAllowed) {
        next();
    } else {
        stream.respond({
            [HTTP2_HEADER_STATUS]: 400,
            [HTTP2_HEADER_CONTENT_TYPE]: "text/plain; charset=utf-8"
        });
        return stream.end("Bad request: push stream is not allowed");
    }
};

export default mustAllowPush;
