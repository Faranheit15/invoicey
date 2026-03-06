import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import Invoice from "../models/Invoice";

interface MigrationInvoice {
  _id: mongoose.Types.ObjectId;
  tax?: number;
}

const run = async () => {
  await connectDB();

  const invoices = (await Invoice.find(
    {
      cgst: { $exists: false },
      tax: { $exists: true, $gt: 0 },
    },
    { _id: 1, tax: 1 }
  ).lean()) as MigrationInvoice[];

  if (!invoices.length) {
    console.log("No invoice records found to migrate.");
    return;
  }

  console.log(`Found ${invoices.length} invoice(s) with legacy tax field.`);

  const operations = invoices.map((invoice) => ({
    updateOne: {
      filter: { _id: invoice._id },
      update: {
        $set: {
          cgst: invoice.tax ?? 0,
          sgst: 0,
        },
      },
    },
  }));

  const result = await Invoice.bulkWrite(operations, { ordered: false });
  console.log(`Migration complete. Updated ${result.modifiedCount} invoice record(s).`);
  console.log("Note: the legacy 'tax' field has been preserved in the DB for reference.");
  console.log("Run the following in MongoDB shell to clean it up after verifying:");
  console.log('  db.invoices.updateMany({ cgst: { $exists: true } }, { $unset: { tax: "" } })');
};

run()
  .catch((error) => {
    console.error("GST migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
