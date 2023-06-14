import DispatchClient from "./DispatchClient.js";

const client = new DispatchClient({
    accessKey: "12345",
    dispatchServerBaseUrl: new URL("http://localhost:6701")
});

await client.start();
