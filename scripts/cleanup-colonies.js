import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);
const ids = ["col_XQEZvhD6GL", "col_Q3y2Lp6jI5"];
const b = await sql.unsafe("SELECT id, name FROM colonies WHERE world_id=$1", ["world_AYjUBQxhR1cQ"]);
console.log("Before:", b.map(c => c.name));
for (const id of ids) {
  // events: delete where this colony is in visibility array
  const evDel = await sql.unsafe("DELETE FROM events WHERE $1 = ANY(visibility)", [id]);
  console.log("  events deleted:", evDel.count);
  const actDel = await sql.unsafe("DELETE FROM actions WHERE colony_id=$1", [id]);
  console.log("  actions deleted:", actDel.count);
  const unitDel = await sql.unsafe("DELETE FROM units WHERE colony_id=$1", [id]);
  console.log("  units deleted:", unitDel.count);
  const setDel = await sql.unsafe("DELETE FROM settlements WHERE colony_id=$1", [id]);
  console.log("  settlements deleted:", setDel.count);
  const agrDel = await sql.unsafe("DELETE FROM agreements WHERE proposed_by=$1 OR proposed_to=$1", [id, id]);
  console.log("  agreements deleted:", agrDel.count);
  const msgDel = await sql.unsafe("DELETE FROM messages WHERE sender_id=$1 OR recipient_id=$1", [id, id]);
  console.log("  messages deleted:", msgDel.count);
  const colDel = await sql.unsafe("DELETE FROM colonies WHERE id=$1", [id]);
  console.log("  colony deleted:", colDel.count);
  console.log("Deleted:", id);
}
const a = await sql.unsafe("SELECT id, name FROM colonies WHERE world_id=$1", ["world_AYjUBQxhR1cQ"]);
console.log("After:", a.map(c => c.name));
await sql.end();
