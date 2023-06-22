export default function getPathOnly(path: string): string{
    const uri = new URL(path, "http://dummy.com");
    return uri.pathname;
}