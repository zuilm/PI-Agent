import "dotenv/config";
import { Sandbox } from "e2b";
const paginator = Sandbox.list({ query: { state: ["running", "paused"] }, limit: 100 });
const items = await paginator.nextItems();
console.log(JSON.stringify(items.map((item) => ({ sandboxId: item.sandboxId, state: item.state, startedAt: item.startedAt, templateId: item.templateId })), null, 2));
