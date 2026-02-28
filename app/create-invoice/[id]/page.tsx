import InvoiceEditor from "@/components/InvoiceEditor";

interface EditInvoicePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditInvoicePage({ params }: EditInvoicePageProps) {
  const { id } = await params;
  return <InvoiceEditor mode="edit" invoiceId={id} />;
}
