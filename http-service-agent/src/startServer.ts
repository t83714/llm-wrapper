import DispatchServer from "./DispatchServer.js";
import { defaultPeerMaxConcurrentStreams } from "./utils/constants.js";
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
            coerce: (v: any[]) => v.filter((item) => !!item),
            demandOption: true,
            type: "string"
        },
        controllerServerPort: {
            describe: "Controller server port.",
            default: 6701,
            type: "number"
        },
        serviceServerPort: {
            describe:
                "Service server (the http/1.1 server that serves LLM requests) port. ",
            default: 6701,
            type: "number"
        },
        pingInterval: {
            describe:
                "Ping internal for controller server to determine the liveness of the client servers",
            default: 3000,
            type: "number"
        },
        enableServiceLogs: {
            describe: "Whether turned on service server access logs",
            default: true,
            type: "boolean"
        },
        debug: {
            describe: "whether turn on debug mode",
            default: false,
            type: "boolean"
        },
        peerMaxConcurrentStreams: {
            describe: "Max. concurrent stream. Default: 500",
            default: defaultPeerMaxConcurrentStreams,
            type: "number"
        },
        gracefulShutdownDeadline: {
            describe:
                "wait up to 25 seconds for existing streams to be finish before force shutdown",
            default: 25000,
            type: "number"
        }
    }).argv;

const server = new DispatchServer(argv);

server.start();

process.on("unhandledRejection", (reason, p) => {
    console.error(`Caught unhandledRejection: ${reason}\n` + "Promise:", p);
});

process.on("uncaughtException", (err, origin) => {
    console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
});
