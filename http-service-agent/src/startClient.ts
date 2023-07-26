import DispatchClient from "./DispatchClient.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = await yargs(hideBin(process.argv))
    .env("APP_CFG")
    .config()
    .help()
    .options({
        accessKey: {
            demandOption: true,
            describe:
                "The remote dispatch server access key. " +
                "Can be a string contains the password only or a string in the format of `username:password`.",
            type: "string"
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

const client = new DispatchClient(argv);

await client.start();

process.on("unhandledRejection", (reason, p) => {
    console.error(`Caught unhandledRejection: ${reason}\n` + "Promise:", p);
});

process.on("uncaughtException", (err, origin) => {
    console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
});
