import "dotenv/config";
import { Sandbox } from "e2b";
const id = process.argv[2];
if (!id) throw new Error("sandbox id required");
console.log(JSON.stringify({ killed: await Sandbox.kill(id) }));
