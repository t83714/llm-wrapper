import http2 from "node:http2";
import { NextFunction } from "./composeStreamMiddleware.js";
import { HttpMethod } from "../utils/constants.js";

const {
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_TYPE
} = http2.constants;

export default function matchMethodPath(
    method: HttpMethod,
    path: string | RegExp
) {
    return (
        stream: http2.ServerHttp2Stream,
        headers: http2.IncomingHttpHeaders,
        next: NextFunction
    ) => {
        if (headers[HTTP2_HEADER_METHOD] === method) {
            const requestPath = headers[HTTP2_HEADER_PATH] as string;
            const requestPathname = new URL(
                requestPath ? requestPath : "",
                "http://dummy.com"
            ).pathname;
            if (
                (typeof path === "string" &&
                    path.toLowerCase() === requestPathname.toLowerCase()) ||
                ((path as any) instanceof RegExp && requestPathname.match(path))
            ) {
                return next();
            }
        }
        // either method or path not match, respond 404
        stream.respond({
            [HTTP2_HEADER_STATUS]: 404,
            [HTTP2_HEADER_CONTENT_TYPE]: "text/plain; charset=utf-8"
        });
        return stream.end("Not found");
    };
}
