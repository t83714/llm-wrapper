import http2 from "node:http2";
import { JSONParser } from "@streamparser/json-node";
const {
    HTTP2_HEADER_METHOD,
    HTTP2_HEADER_PATH,
    HTTP2_HEADER_STATUS,
    HTTP2_HEADER_CONTENT_TYPE
} = http2.constants;
import { Readable } from "node:stream";
import { HttpMethod } from "./constants.js";

export interface PushRequestOptions {
    method: HttpMethod;
    path: string;
    contentType?: string;
    data?: Buffer | Readable;
    returnStream?: boolean;
}

async function sendPushRequest<T = any>(
    controllerStream: http2.ServerHttp2Stream,
    options: PushRequestOptions
) {
    const { method, path, data } = options;
    const returnStream = options?.returnStream === true ? true : false;
    const contentType = options?.contentType
        ? options.contentType
        : "application/json";
    if (!method) {
        throw new Error(`sendPushRequest: Invalid empty method.`);
    }
    if (!path) {
        throw new Error(`sendPushRequest: Invalid empty path.`);
    }
    const pStream = new Promise<http2.ServerHttp2Stream>((resolve, reject) => {
        controllerStream.pushStream(
            {
                [HTTP2_HEADER_METHOD]: method,
                [HTTP2_HEADER_PATH]: path,
                [HTTP2_HEADER_CONTENT_TYPE]: contentType
            },
            (err, pushStream, headers) => {
                try {
                    if (err) throw err;
                    if (data) {
                        if (data instanceof Readable) {
                            data.pipe(pushStream);
                            data.on("error", (err) => {
                                reject(err);
                                pushStream.destroy(err);
                            });
                            data.on("end", () => {
                                resolve(pushStream);
                            });
                        } else {
                            pushStream.write(data, (err) => {
                                if (err) {
                                    reject(err);
                                    pushStream.destroy(err);
                                } else {
                                    resolve(pushStream);
                                }
                            });
                        }
                    } else {
                        resolve(pushStream);
                    }
                } catch (err) {
                    reject(err);
                    pushStream.destroy();
                }
            }
        );
    });

    // request data has been sent
    const stream = await pStream;
    if (returnStream) {
        return stream;
    }
    const pDecodeRes = new Promise<T>((resolve, reject) => {
        try {
            const parser = new JSONParser();
            stream.pipe(parser);
            let valueEmitted = false;
            parser.on("data", (value) => {
                if (valueEmitted) {
                    return;
                }
                valueEmitted = true;
                resolve(value);
            });
            parser.end(() => {
                resolve(undefined as any);
            });
        } catch (err) {
            reject(err);
            stream.destroy();
        }
    });
    return await pDecodeRes;
}

export default sendPushRequest;
