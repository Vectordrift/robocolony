const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);
(async () => {
  const ids = ["col_XQEZvhD6GL", "col_Q3y2Lp6jI5"];
  const b = await sql.unsafe("SELECT id, name FROM colonies WHERE world_id=$1", ["world_AYjUBQxhR1cQ"]);
  console.log("Before:", b.map(c => c.name));
  for (const id of ids) {
    for (const t of ["events", "actions", "units", "settlements"]) {
      await sql.unsafe("DELETE FROM " + t + " WHERE colony_id=$1", [id]);
    }
    await sql.unsafe("DELETE FROM agreements WHERE proposed_by=$1 OR proposed_to=$1", [id, id]);
    await sql.unsafe("DELETE FROM messages WHERE sender_id=$1 OR recipient_id=$1", [id, id]);
    await sql.unsafe("DELETE FROM colonies WHERE id=$1", [id]);
    console.log("Deleted:", id);
  }
  const a = await sql.unsafe("SELECT id, name FROM colonies WHERE world_id=$1", ["world_AYjUBQxhR1cQ"]);
  console.log("After:", a.map(c => c.name));
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });
