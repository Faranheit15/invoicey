import { useState } from "react";

export default function InvoiceForm() {
  const [items, setItems] = useState([{ name: "", price: 0, quantity: 1 }]);

  const handleChange = (index: number, key: string, value: any) => {
    const updatedItems = [...items];
    updatedItems[index][key] = value;
    setItems(updatedItems);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Create Invoice</h2>
      {items.map((item, index) => (
        <div key={index} className="flex space-x-2">
          <input value={item.name} onChange={(e) => handleChange(index, "name", e.target.value)} placeholder="Item Name" />
          <input type="number" value={item.price} onChange={(e) => handleChange(index, "price", Number(e.target.value))} placeholder="Price" />
          <input type="number" value={item.quantity} onChange={(e) => handleChange(index, "quantity", Number(e.target.value))} placeholder="Qty" />
        </div>
      ))}
      <button onClick={() => setItems([...items, { name: "", price: 0, quantity: 1 }])}>Add Item</button>
    </div>
  );
}
