import PDFDocument from "pdfkit";
import archiver from "archiver";
import Order from "../models/order.js";
import User from "../models/user.js";

// Helper: Get date range for filtering
function getDateRange(period, dateStr) {
  const input = dateStr ? new Date(dateStr) : new Date();
  let start, end;
  if (period === "day") {
    start = new Date(input.setHours(0, 0, 0, 0));
    end = new Date(input.setHours(23, 59, 59, 999));
  } else if (period === "week") {
    const dayOfWeek = input.getDay();
    start = new Date(input);
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (period === "month") {
    start = new Date(input.getFullYear(), input.getMonth(), 1);
    end = new Date(input.getFullYear(), input.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else if (period === "all") {
    return {
      start: new Date(0), // Earliest possible date
      end: new Date(), // Now
    };
  } else {
    throw new Error("Invalid period");
  }
  return { start, end };
}

// PDF Generation (with table look for items)
async function generateInvoicePDF(order) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Company Info
    doc
      .fontSize(18)
      .text("THE VIBE THREAD", 40, 40)
      .fontSize(11)
      .text("Dehradun, Uttarakhand, 248002")
      .text("thevibethread@gmail.com | +91 75791 13892")
      .moveDown();

    doc.fontSize(20).text("INVOICE", { align: "center" }).moveDown(0.5);

    // Invoice Meta
    doc
      .fontSize(12)
      .text(`Order ID: ${order.orderId || ""}`)
      .text(`Invoice Date: ${new Date().toLocaleDateString()}`)
      .text(
        `Order Date: ${
          order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ""
        }`
      )
      .moveDown();

    // Customer Info
    doc
      .text(
        `Customer: ${order.shippingAddress?.name || order.user?.name || ""}`
      )
      .text(`Email: ${order.shippingAddress?.email || order.user?.email || ""}`)
      .text(
        `Shipping: ${order.shippingAddress?.address || ""}, ${
          order.shippingAddress?.city || ""
        }, ${order.shippingAddress?.postalCode || ""}, ${
          order.shippingAddress?.country || ""
        }`
      )
      .moveDown();

    // Items Table as Table (draw lines, columns aligned)
    const tableTop = doc.y;
    const itemColX = [40, 240, 340, 440]; // Name, Qty, Unit Price, Total

    // Draw header row
    doc.fontSize(14).text("Items:", itemColX[0], tableTop, { underline: true });
    doc.moveDown(0.5);

    // Draw table header
    doc
      .fontSize(12)
      .text("Name", itemColX[0], doc.y, { continued: true })
      .text("Qty", itemColX[1], doc.y, { continued: true })
      .text("Unit Price", itemColX[2], doc.y, { continued: true })
      .text("Total", itemColX[3], doc.y);

    // Draw header underline
    const headerBottomY = doc.y + 2;

    // Draw header underline
    doc
      .moveTo(itemColX[0], headerBottomY)
      .lineTo(itemColX[3] + 60, headerBottomY)
      .stroke();

    doc.moveDown(2);

    let subtotal = 0;
    (order.products || []).forEach((item, idx) => {
      const name =
        typeof item.product === "object" && item.product?.name
          ? item.product.name
          : "Unnamed";
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.priceAtOrder) || 0;
      const totalPrice = +(price * quantity).toFixed(2);
      subtotal += totalPrice;

      // Draw item row as table (fixed positions)
      const rowY = doc.y;
      doc.fontSize(12).text(name, itemColX[0], rowY);
      doc.text(quantity.toString(), itemColX[1], rowY);
      doc.text(`INR${price.toString()}`, itemColX[2], rowY);
      doc.text(`INR${totalPrice.toString()}`, itemColX[3], rowY);
      doc.moveDown();
    });

    // Draw table bottom line
    doc
      .moveTo(itemColX[0], doc.y + 5)
      .lineTo(itemColX[3] + 60, doc.y + 5)
      .stroke();

    doc.moveDown();
    doc
      .fontSize(12)
      .text(`Subtotal: INR${subtotal.toString()}`, { align: "right" })
      .text(`Shipping: INR${(order.shippingCost || 0).toString()}`, {
        align: "right",
      })
      .text(`Total Paid: INR${(order.totalPrice || subtotal).toString()}`, {
        align: "right",
      })
      .moveDown();

    doc.text(`Payment Method: ${order.paymentMethod || ""}`, {
      align: "right",
    });
    doc.text(`Order Status: ${order.status || ""}`, { align: "right" });
    if (order.trackingNumber) {
      doc.text(`Tracking Number: ${order.trackingNumber}`, { align: "right" });
    }
    if (order.deliveredAt) {
      doc.text(
        `Delivered At: ${new Date(order.deliveredAt).toLocaleDateString()}`,
        { align: "right" }
      );
    }
    doc.moveDown(2);
    doc
      .fontSize(10)
      .fillColor("gray")
      .text("Thank you for your purchase!", { align: "center" });
    doc.end();
  });
}

// 1. Single Invoice PDF (user)
export const downloadOrderInvoice = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user._id;
    const order = await Order.findById(orderId)
      .populate("user", "name email")
      .populate("products.product");
    console.log("Fetched order data:", JSON.stringify(order, null, 2));
    if (!order || String(order.user._id) !== String(userId)) {
      return res
        .status(403)
        .json({ message: "Order not found or unauthorized." });
    }
    const pdfBuffer = await generateInvoicePDF(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Invoice-${orderId}.pdf`
    );
    res.send(pdfBuffer);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Could not generate invoice", error: err.message });
  }
};

// 3. Bulk Invoice Download for admin (ZIP, filtered, paginated)
export const downloadBulkAdminInvoices = async (req, res) => {
  console.log("function downloadBulkAdminInvoices called");
  console.log("Bulk admin invoice request query:", req.query);
  try {
    const { period, date, status, email, page = 1, pageSize = 50 } = req.query;
    const { start, end } = getDateRange(period, date);

    let filter = { createdAt: { $gte: start, $lte: end } };
    if (status) filter.status = status;
    if (email) {
      const user = await User.findOne({ email });
      if (user) filter.user = user._id;
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize))
      .populate("user", "name email")
      .populate("products.product");

    console.log("Bulk admin filter:", filter);
    console.log(
      "Orders found:",
      orders.length,
      orders.map((o) => o._id)
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=invoices-admin.zip`
    );
    const archive = archiver("zip");
    archive.pipe(res);

    for (const order of orders) {
      console.log("Generating PDF for order", order._id);
      const pdfBuffer = await generateInvoicePDF(order);
      archive.append(pdfBuffer, { name: `Invoice-${order._id}.pdf` });
    }
    archive.finalize();
  } catch (err) {
    res.status(500).json({
      message: "Could not generate bulk invoices",
      error: err.message,
    });
  }
};
