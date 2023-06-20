import pkg from "#package.json" assert { type: "json" };
import { ControlCommands } from "./constants.js";

export type CommandRoleType = "server" | "client";

export interface CommandDataType {
    version: string;
    app: string;
    type: string;
    role: CommandRoleType;
    time: string;
    [key: string]: any;
}

export interface DelegateRequestCommandDataType extends CommandDataType {
    method: string;
    path: string;
    // request data
    data?: any;
    headers?: Record<string, string>;
    // a new request to dispatch server for passing the response
    responsePath: string;
}

const createCommandData = (
    type: (typeof ControlCommands)[keyof typeof ControlCommands],
    role: CommandRoleType,
    extraData?: Record<string, any>
) => ({
    version: pkg.version,
    app: pkg.name,
    type: ControlCommands.hello,
    role: "server",
    time: new Date().toTimeString(),
    ...(extraData ? extraData : {})
});

export default createCommandData;
