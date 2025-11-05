import mongoose from "mongoose";
import slugify from "slugify";

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "Rating must be an integer between 1 and 5.",
      },
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      minLength: 5,
      maxLength: 1000,
    },
    edited: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const sizeSchema = new mongoose.Schema(
  {
    quantity: { type: Number, required: true, min: 0 },
    sku: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, unique: true, required: true, index: true },
    brand: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    discount: {
      price: {
        type: Number,
        min: 0,
        validate: {
          validator(value) {
            return value < this.price;
          },
          message: "Discount price must be less than the original price.",
        },
      },
      expiryDate: { type: Date },
    },
    category: { type: String, required: true, trim: true },
    fabric: { type: String, trim: true }, // <-- Add this line
    tags: [{ type: String }],
    Trending: { type: Boolean, default: false },
    NewArrival: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    numReviews: { type: Number, default: 0 },
    weight: { type: Number, min: 0 },
    dimensions: { type: String, trim: true },
    moreDetails: { type: String, trim: true },
    returnPolicy: { type: String, trim: true },
    howToCare: { type: String, trim: true },
    reviews: [reviewSchema],
    colors: [
      {
        name: { type: String, required: true },
        icon: { type: String, required: true }, // <-- Add this line for color icon/thumbnail
        images: [{ type: String, required: true }],
        sizes: {
          type: Map,
          of: sizeSchema,
          default: {},
        },
      },
    ],

    // SEO fields
    metaTitle: { type: String },
    metaDescription: { type: String },
    metaKeywords: [{ type: String }],

    // Bestseller field
    bestseller: { type: Boolean, default: false },

    // Sales count (optional, for automatic bestseller logic)
    salesCount: { type: Number, default: 0 },

    // Preorder fields
    preorderAvailable: { type: Boolean, default: false },
    preorderDiscountType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },
    preorderDiscountValue: { type: Number, default: 100 },
  },

  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// 🔹 Normalize tags and slug before save
productSchema.pre("save", function (next) {
  if (!this.slug || this.isModified("name")) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }

  if (this.tags?.length) {
    this.tags = this.tags.map((tag) => tag.toLowerCase().trim());
  }

  next();
});

// 🔹 Auto-generate slug on name update
productSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  if (update?.name) {
    update.slug = slugify(update.name, { lower: true, strict: true });
  }

  if (update?.tags?.length) {
    update.tags = update.tags.map((tag) => tag.toLowerCase().trim());
  }

  this.setUpdate(update);
  next();
});

// 🔹 SKU uniqueness check before save
productSchema.pre("save", async function (next) {
  const skus = [];

  for (const color of this.colors) {
    for (const [size, details] of color.sizes.entries()) {
      if (details?.sku) skus.push(details.sku);
    }
  }

  if (skus.length) {
    const existing = await mongoose.models.Product.findOne({
      "colors.sizes.sku": { $in: skus },
      _id: { $ne: this._id },
    });
    if (existing)
      return next(new Error("Duplicate SKU found. Each SKU must be unique."));
  }

  next();
});

// 🔹 SKU uniqueness check before update
productSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate();
  const skus = [];

  if (update?.colors?.length) {
    for (const color of update.colors) {
      if (!color.sizes) continue;

      const sizeEntries =
        color.sizes instanceof Map
          ? Array.from(color.sizes.entries())
          : Object.entries(color.sizes);
      for (const [_, details] of sizeEntries) {
        if (details?.sku) skus.push(details.sku);
      }
    }

    if (skus.length) {
      const existing = await mongoose.models.Product.findOne({
        "colors.sizes.sku": { $in: skus },
        _id: { $ne: this.getQuery()._id },
      });
      if (existing)
        return next(new Error("Duplicate SKU found during update."));
    }
  }

  next();
});

// 🔹 Virtuals
productSchema.virtual("countInStock").get(function () {
  const colors = Array.isArray(this.colors) ? this.colors : [];
  return colors.reduce((sum, color) => {
    const sizes =
      color.sizes instanceof Map
        ? Array.from(color.sizes.values())
        : color.sizes
        ? Object.values(color.sizes)
        : [];
    return (
      sum + sizes.reduce((qtySum, size) => qtySum + (size.quantity || 0), 0)
    );
  }, 0);
});

productSchema.virtual("calculatedDiscount").get(function () {
  return this.discount?.price && this.price
    ? Math.round(((this.price - this.discount.price) / this.price) * 100)
    : 0;
});

productSchema.virtual("outOfStockColors").get(function () {
  const colors = Array.isArray(this.colors) ? this.colors : [];
  return colors.map((color) => ({
    name: color.name,
    outOfStock: color.sizes
      ? (color.sizes instanceof Map
          ? Array.from(color.sizes.values())
          : Object.values(color.sizes)
        ).every((size) => size.quantity === 0)
      : true,
  }));
});

productSchema.virtual("outOfStockSizes").get(function () {
  const stockBySize = {};
  const colors = Array.isArray(this.colors) ? this.colors : [];
  colors.forEach((color) => {
    const sizes =
      color.sizes instanceof Map
        ? Array.from(color.sizes.entries())
        : Object.entries(color.sizes || {});
    sizes.forEach(([size, details]) => {
      stockBySize[size] = (stockBySize[size] || 0) + (details.quantity || 0);
    });
  });
  return Object.entries(stockBySize).map(([size, qty]) => ({
    size,
    outOfStock: qty === 0,
    quantity: qty,
  }));
});

productSchema.virtual("stockStatus").get(function () {
  return this.countInStock > 0 ? "In Stock" : "Out of Stock";
});

productSchema.virtual("reviewSummary").get(function () {
  return `${
    this.numReviews
  } ${this.numReviews === 1 ? "review" : "reviews"} - ${this.rating} ⭐`;
});

// 🔹 Static: Update rating/numReviews
productSchema.statics.updateRatings = async function (productId) {
  const result = await this.aggregate([
    { $match: { _id: productId } },
    { $unwind: { path: "$reviews", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$_id",
        numReviews: { $sum: 1 },
        avgRating: { $avg: "$reviews.rating" },
      },
    },
  ]);

  await this.findByIdAndUpdate(productId, {
    numReviews: result[0]?.numReviews || 0,
    rating: result[0] ? parseFloat(result[0].avgRating.toFixed(1)) : 0,
  });
};

// 🔹 Indexes
productSchema.index({ name: "text", description: "text", tags: "text" });
productSchema.index({ category: 1, brand: 1 });
productSchema.index({ Trending: 1, NewArrival: 1 });

export default mongoose.model("Product", productSchema);
