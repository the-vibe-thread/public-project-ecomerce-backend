import axios from "axios";

/**
 * Send a single product/order to ShipCorrect.
 * @param {Object} order - The order object (with shipping address, payment, etc.)
 * @param {Object} product - The product object (one at a time)
 * @returns {Promise<Object>} - The ShipCorrect API response
 */
export async function sendToShipCorrect(order, product) {
  const payload = {
    api_key: String(process.env.SHIPCORRECT_API_KEY),
    customer_name: String(order.shippingAddress?.name || ""),
    customer_email: String(order.shippingAddress?.email || ""),
    customer_address1: String(order.shippingAddress?.address || ""),
    customer_address2: String(order.shippingAddress?.addressLine2 || ""),
    customer_address_landmark: String(order.shippingAddress?.landmark || ""),
    customer_address_state: String(order.shippingAddress?.state || ""),
    customer_address_city: String(order.shippingAddress?.city || ""),
    customer_address_pincode: String(order.shippingAddress?.postalCode || ""),
    customer_contact_number1: String(order.shippingAddress?.deliveryPhone || ""),
    customer_contact_number2: String(order.shippingAddress?.altPhone || ""),
    product_id: String(
      product.productId?._id ||
      product.productId?.toString() ||
      product.productId ||
      ""
    ),
    product_name: String(product.name || product.productName || ""),
    sku: String(product.sku || ""),
    mrp: String(product.mrp || product.price || ""),
    product_size: String(product.size || ""),
    product_weight: String(product.weight || ""),
    product_color: String(product.color || ""),
    pay_mode: String(order.paymentMethod === "cod" ? "COD" : "PREPAID"),
    quantity: String(product.quantity || "1"),
    total_amount: String(order.totalPrice || ""),
    client_order_no: String(order.orderId || order._id || ""),
  };

  try {
    const response = await axios.post(
      process.env.SHIPCORRECT_API_URL, // e.g. "https://api.shipcorrect.com/create-order"
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    return response.data;
  } catch (error) {
    console.error("ShipCorrect API error:", error.response?.data || error.message);
    throw new Error("Failed to send order to ShipCorrect");
  }
}


/**
 * Fetch live tracking info from ShipCorrect for a given order_no
 * @param {string} orderId - The ShipCorrect order_no
 * @returns {Promise<Object>} - Tracking data from ShipCorrect
 */
export async function fetchShipCorrectTracking(orderId) {
  const payload = {
    api_key: String(process.env.SHIPCORRECT_API_KEY),
    order_no: String(orderId),
  };
  try {
    const response = await axios.post(
      process.env.SHIPCORRECT_TRACKING_API_URL, // e.g. "https://api.shipcorrect.com/track-order"
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    return response.data;
  } catch (error) {
    console.error("ShipCorrect tracking API error:", error.response?.data || error.message);
    throw new Error("Failed to fetch ShipCorrect tracking info");
  }
}