import http2 from "node:http2";
import { NextFunction } from "./composeStreamMiddleware.js";

const {
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_TYPE,
    HTTP2_HEADER_AUTHORIZATION,
    HTTP2_HEADER_WWW_AUTHENTICATE
} = http2.constants;

export const DEFAULT_USERNAME = "http-service-agent";

/**
 * a middleware checking implement simple access control via basic auth protocol.
 *
 * @export
 * @param {string[]} accessKeys
 *  A list of plain text access key string in format of `${username}:${password}`.
 *  The `${username}:` portion can be omitted --- when it happens, the default username will be used during the credentials verification.
 * @return {*}
 */
export default function basicAuth(
    accessKeys?: string[],
    defaultUsername: string = DEFAULT_USERNAME
) {
    return (
        stream: http2.ServerHttp2Stream,
        headers: http2.IncomingHttpHeaders,
        next: NextFunction
    ) => {
        if (!accessKeys?.length) {
            return next();
        }
        const authHeader = headers[HTTP2_HEADER_AUTHORIZATION];
        if (!authHeader || typeof authHeader !== "string") {
            stream.respond({
                [HTTP2_HEADER_STATUS]: 401,
                [HTTP2_HEADER_CONTENT_TYPE]: "text/plain; charset=utf-8",
                [HTTP2_HEADER_WWW_AUTHENTICATE]: `Basic realm="http-service-agent"`
            });
            return stream.end("Unauthorized");
        }
        const decodedKey = Buffer.from(
            authHeader.replace(/^basic\s/i, ""),
            "base64"
        ).toString("utf8");

        if (
            accessKeys.findIndex((accessKey) => {
                const credentials =
                    accessKey.indexOf(":") === -1
                        ? // when access key doesn't contain username, the default username will be used.
                          `${defaultUsername}:${accessKey}`
                        : accessKey;
                return credentials === decodedKey;
            }) === -1
        ) {
            stream.respond({
                [HTTP2_HEADER_STATUS]: 403,
                [HTTP2_HEADER_CONTENT_TYPE]: "text/plain; charset=utf-8"
            });
            return stream.end("Forbidden");
        }
        return next();
    };
}
