# One-Time Migration: test → clientsvia

Run this on Render SSH **after** you update MONGODB_URI to include `/clientsvia`:

```bash
node -e '
const { MongoClient } = require("mongodb");
(async () => {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  await client.connect();
  
  console.log("Connected to:", client.db().databaseName);
  
  const source = client.db("test");
  const target = client.db("clientsvia");
  
  // Collections to copy
  const collections = [
    "companyLocalTriggers",
    "companytriggersettings", 
    "companiesCollection",
    "v2companies"
  ];
  
  for (const coll of collections) {
    const sourceCount = await source.collection(coll).countDocuments({});
    console.log(`\n${coll}:`);
    console.log(`  test: ${sourceCount} docs`);
    
    if (sourceCount > 0) {
      const docs = await source.collection(coll).find({}).toArray();
      try {
        const result = await target.collection(coll).insertMany(docs, { ordered: false });
        console.log(`  ✅ Copied ${result.insertedCount} to clientsvia`);
      } catch (e) {
        if (e.code === 11000) {
          console.log(`  ⚠️  Some duplicates skipped`);
        } else {
          throw e;
        }
      }
    }
    
    const targetCount = await target.collection(coll).countDocuments({});
    console.log(`  clientsvia: ${targetCount} docs (after)`);
  }
  
  // Verify Penguin triggers
  const penguinCount = await target.collection("companyLocalTriggers").countDocuments({
    companyId: "68e3f77a9d623b8058c700c4",
    state: "published"
  });
  console.log(`\n✅ Penguin Air triggers in clientsvia: ${penguinCount}`);
  
  // DROP TEST DATABASE
  console.log(`\n🔥 Dropping "test" database...`);
  await source.dropDatabase();
  console.log(`✅ "test" database NUKED`);
  
  await client.close();
})();
'
```

## Steps:

1. **First:** Update MONGODB_URI in Render to include `/clientsvia`
2. **Wait:** For deploy to succeed (server will start successfully)
3. **SSH:** Into Render
4. **Run:** The command above
5. **Verify:** Should show "Penguin Air triggers in clientsvia: 42"
6. **Test:** Make a call saying "I smell gas"

The script will be available once deployment succeeds, but you can use this one-liner immediately.
