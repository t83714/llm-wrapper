import http2 from "node:http2";

export type NextFunction = (err?: Error) => any | (() => any);

export type StreamMiddlewareType = (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    next: NextFunction
) => any;

const noop = () => undefined;

function composeStreamMiddleware(
    middlewareList: StreamMiddlewareType[],
    next?: NextFunction
) {
    const nextCall = next ? next : noop;
    const runNext = (
        stream: http2.ServerHttp2Stream,
        headers: http2.IncomingHttpHeaders
    ) => {
        if (!middlewareList.length) {
            return nextCall();
        }
        const currentMiddleware = middlewareList.shift();
        currentMiddleware!(
            stream,
            headers,
            runNext.bind(null, stream, headers)
        );
    };
    return runNext;
}

export default composeStreamMiddleware;
