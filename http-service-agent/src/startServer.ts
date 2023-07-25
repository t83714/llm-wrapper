import DispatchServer from "./DispatchServer.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = await yargs(hideBin(process.argv))
    .env("APP_CFG")
    .config()
    .help()
    .options({
        accessKeys: {
            array: true,
            describe:
                "A list of acceptable access key strings." +
                "Each access key can be a string contains the password only or a string in the format of `username:password`.",
                coerce: (v) => {
                    console.log(`coerce accessKeys: ${typeof v}`);
                    return v;
                },
            type: "array"
        },
        dispatchServerBaseUrl: {
            describe: "the dispatch server base url.",
            default: "http://localhost:6701",
            coerce: (v) => new URL(v),
            type: "string"
        },
        targetServerBaseUrl: {
            demandOption: true,
            describe: "Target workload server base url.",
            coerce: (v) => new URL(v),
            type: "string"
        },
        peerMaxConcurrentStreams: {
            describe: "Max. concurrent stream. Default: 500",
            type: "number"
        }
    }).argv;

console.log(argv);

/**
 * 
 * accessKeys: [] as string[],
    controllerServerPort: 6701,
    serviceServer: 6702,
    peerMaxConcurrentStreams: defaultPeerMaxConcurrentStreams,
    // in milliseconds, used to keep session.
    pingInterval: 3000,
    enableServiceLogs: true,
    debug: false,
    // wait up to 25 seconds for existing streams to be finish
    // before force shutdown
    gracefulShutdownDeadline: 25000
 * 
 */

const server = new DispatchServer({
    accessKeys: ["12345"],
    debug: false
});

server.start();

process.on("uncaughtException", (err, origin) => {
    console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
});
