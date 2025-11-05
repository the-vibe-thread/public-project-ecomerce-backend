import { Schema, model } from "mongoose";

const discountSchema = new Schema(
  {
    code: { 
      type: String, 
      unique: true, 
      required: true, 
      uppercase: true, 
      trim: true, 
      index: true 
    },
    discountType: { 
      type: String, 
      enum: [
        "fixed", 
        "percentage", 
        "first_order", 
        "loyalty", 
        "cart_discount", 
        "bulk_discount", 
        "seasonal", 
        "referral", 
        "buy_x_get_y", 
        "free_shipping", 
        "payment_method", 
        "app_discount"
      ], 
      required: true 
    },
    discountValue: { 
      type: Number, 
      required: true 
    },
    expiryDate: { 
      type: Date, 
      required: true 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    usageLimit: { 
      type: Number, 
      default: 1 
    },
    usedCount: { 
      type: Number, 
      default: 0 
    },
    minOrderAmount: { 
      type: Number, 
      default: 0 
    },
    allowedUsers: [{ 
      type: Schema.Types.ObjectId, 
      ref: "User" 
    }],
    productSlugs: [{ 
      type: String, 
      trim: true, 
      lowercase: true 
    }],
    minQuantity: { 
      type: Number, 
      default: 1 
    },
    buyXGetY: {
      type: {
        buy: { type: Number, default: 1 },
        get: { type: Number, default: 1 }
      },
      default: { buy: 1, get: 1 }
    },
    seasonalStartDate: { 
      type: Date 
    },
    seasonalEndDate: { 
      type: Date 
    },
    paymentMethod: { 
      type: String, 
      enum: ["credit_card", "paypal", "bank_transfer", "stripe"] 
    },
    isAppDiscount: { 
      type: Boolean, 
      default: false 
    },
    usersUsed: [{ 
      type: Schema.Types.ObjectId, 
      ref: "User" 
    }] // Track users who have used the discount
  },
  { timestamps: true }
);

// Virtual field to check if expired
discountSchema.virtual("isExpired").get(function () {
  return this.expiryDate < new Date();
});

// Ensure `productSlugs` is always an array
discountSchema.pre("save", function (next) {
  if (this.productSlugs && !Array.isArray(this.productSlugs)) {
    this.productSlugs = [this.productSlugs]; // Convert single slug to an array
  }
  next();
});

// Virtual for calculating actual discount value based on type
discountSchema.virtual("calculatedValue").get(function () {
  if (this.discountType === "percentage") {
    return this.discountValue / 100;
  } else if (this.discountType === "fixed") {
    return this.discountValue;
  }
  return 0;
});

// Check if the discount can be applied to the current cart value
discountSchema.methods.isApplicable = function (cartValue, productSlugs = [], userId = null) {
  if (cartValue < this.minOrderAmount) return false; // Check for min order amount

  if (this.allowedUsers.length && !this.allowedUsers.includes(userId)) return false; // User is allowed
  
  if (this.productSlugs.length && !productSlugs.some(slug => this.productSlugs.includes(slug))) return false; // Product slug check
  
  if (this.isExpired) return false; // Check if expired

  if (this.usedCount >= this.usageLimit) return false; // Check usage limit

  return true;
};

// Track discount usage by the user
discountSchema.methods.applyDiscount = async function (userId) {
  if (this.usersUsed.includes(userId)) {
    throw new Error("This discount has already been used by this user.");
  }

  // Increment used count and add user to the list
  this.usedCount += 1;
  this.usersUsed.push(userId);

  // Save the updated discount
  await this.save();
};

export default model("Discount", discountSchema);
