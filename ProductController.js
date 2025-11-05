import asyncHandler from "express-async-handler";
import Product from "../models/product.js";
import Order from "../models/order.js";
import slugify from "slugify";
import { getIoInstance } from "../socket.js";

// Utility function to generate full image URLs
const generateFullImageUrls = (req, images) =>
  (Array.isArray(images) ? images : []).map((image) =>
    image.startsWith("http")
      ? image
      : `${req.protocol}://${req.get("host")}${image}`
  );

const generateFullColorData = (req, colors) =>
  (Array.isArray(colors) ? colors : []).map((color) => ({
    ...color,
    icon: color.icon
      ? color.icon.startsWith("http")
        ? color.icon
        : `${req.protocol}://${req.get("host")}${color.icon}`
      : "",
    images: generateFullImageUrls(req, color.images),
  }));

// @desc    Fetch all products with pagination, sorting, and search
// @route   GET /api/products
export const getProducts = asyncHandler(async (req, res) => {
  const pageSize = Number(req.query.pageSize || req.query.limit) || 10;
  const page = Number(req.query.page) || 1;
  const sortOption = req.query.sort || "newest";
  const keyword = req.query.keyword
    ? { name: { $regex: req.query.keyword, $options: "i" } }
    : {};

  // Trim category filter (important for robustness!)
  let categoryFilter = {};
  if (req.query.category) {
    console.log(
      "Category param:",
      req.query.category,
      "Filter:",
      categoryFilter
    );
    const trimmedCat = req.query.category.trim();
    categoryFilter = { category: { $regex: `^${trimmedCat}$`, $options: "i" } };
  }

  let sortQuery = {};
  if (sortOption === "price-asc") sortQuery = { price: 1 };
  if (sortOption === "price-desc") sortQuery = { price: -1 };
  if (sortOption === "newest") sortQuery = { createdAt: -1 };

  // Debug log
  console.log("Category filter:", categoryFilter);

  const count = await Product.countDocuments({ ...keyword, ...categoryFilter });
  const products = await Product.find({ ...keyword, ...categoryFilter })
    .sort(sortQuery)
    .limit(pageSize)
    .skip(pageSize * (page - 1));

  const productsWithImages = products.map((product) => ({
    ...product.toObject(),
    images: generateFullImageUrls(req, product.images),
    colors: generateFullColorData(req, product.colors),
  }));

  res.json({
    products: productsWithImages,
    page,
    pages: Math.ceil(count / pageSize),
    totalProducts: count,
  });
});

// @desc    Get top trending products
// @route   GET /api/products/top
export const getTopProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ isTrending: true })
    .sort({ createdAt: -1 })
    .limit(5);

  const productsWithImages = products.map((product) => ({
    ...product.toObject(),
    images: generateFullImageUrls(req, product.images),
  }));

  res.json(productsWithImages);
});

// @desc    Fetch single product by slug
// @route   GET /api/products/:slug
export const getProductBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (product) {
    res.json({
      ...product.toObject(),
      images: generateFullImageUrls(req, product.images),
      colors: generateFullColorData(req, product.colors), // <-- Add this line
    });
  } else {
    res.status(404).json({ message: "Product not found" });
  }
});

// @desc    Add product review
// @route   POST /api/products/:slug/review
// @desc    Create product review (only if delivered and not cancelled)
// @route   POST /api/products/:slug/review
// @access  Private
export const createReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { slug } = req.params;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be between 1 and 5." });
  }

  const product = await Product.findOne({ slug });

  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }

  const alreadyReviewed = product.reviews.find(
    (review) => review.user.toString() === req.user._id.toString()
  );

  if (alreadyReviewed) {
    return res
      .status(400)
      .json({ message: "You have already reviewed this product." });
  }

  // ✅ Check for eligible delivered, non-cancelled order
  const eligibleOrder = await Order.findOne({
    user: req.user._id,
    status: "Delivered",
    "products.product": product._id,
  });

  if (!eligibleOrder) {
    return res.status(403).json({
      message:
        "You can only review products you have received and not cancelled.",
    });
  }

  product.reviews.push({
    user: req.user._id,
    username: req.user.name,
    rating: Number(rating),
    comment,
  });

  await product.save();
  await product.constructor.updateRatings(product._id);

  res.status(201).json({ message: "Review added successfully!" });
});

// @desc    Get product details with paginated reviews
// @route   GET /api/products/:slug/reviews
export const getProductWithReviews = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const page = Number(req.query.page) || 1;
  const pageSize = 5;

  const product = await Product.findOne({ slug }).populate({
    path: "reviews",
    options: {
      sort: { createdAt: -1 },
      limit: pageSize,
      skip: pageSize * (page - 1),
    },
  });

  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }

  const totalReviews = product.reviews.length;
  const totalPages = Math.ceil(totalReviews / pageSize);

  res.json({
    product,
    reviews: product.reviews,
    page,
    totalPages,
  });
});

// @desc    Get product suggestions for search
// @route   GET /api/products/suggestions?query=searchTerm
export const getProductSuggestions = asyncHandler(async (req, res) => {
  const query = req.query.query;

  if (!query) {
    return res.json({ products: [] });
  }

  const products = await Product.find({
    name: { $regex: query, $options: "i" },
  }).limit(5);

  const productsWithImages = products.map((product) => ({
    ...product.toObject(),
    images: generateFullImageUrls(req, product.images),
  }));

  res.json({ products: productsWithImages });
});

// @desc    Get all products with filters, search, and pagination
// @route   GET /api/admin/products
// @access  Private/Admin
export const getProductsBYAdmin = asyncHandler(async (req, res) => {
  const {
    search,
    category,
    trending,
    newArrival,
    color,
    size,
    sortBy,
    page = 1,
    limit = 10,
  } = req.query;

  const query = {};

  // 🔹 Search by text fields
  if (search) {
    query.$text = { $search: search };
  }

  // 🔹 Category filter
  if (category) {
    query.category = category;
  }

  // 🔹 Trending & New Arrival filters
  if (trending) query.Trending = trending === "true";
  if (newArrival) query.NewArrival = newArrival === "true";

  // 🔹 Color filter
  if (color) {
    query["colors.colorName"] = color;
  }

  // 🔹 Size filter
  if (size) {
    query["colors.sizes." + size] = { $gt: 0 }; // Ensures the size is in stock
  }

  // 🔹 Pagination Logic
  const pageNumber = Number(page) || 1;
  const pageSize = Number(limit) || 10;
  const skip = (pageNumber - 1) * pageSize;

  // 🔹 Sorting Logic
  const sortOptions = {};
  if (sortBy === "priceLowHigh") sortOptions.price = 1;
  if (sortBy === "priceHighLow") sortOptions.price = -1;
  if (sortBy === "stockLowHigh") sortOptions.countInStock = 1;
  if (sortBy === "stockHighLow") sortOptions.countInStock = -1;
  if (sortBy === "salesLowHigh") sortOptions.soldCount = 1;
  if (sortBy === "salesHighLow") sortOptions.soldCount = -1;

  const products = await Product.find(query)
    .sort(sortOptions)
    .skip(skip)
    .limit(pageSize);

  const totalProducts = await Product.countDocuments(query);

  res.json({
    products,
    totalProducts,
    totalPages: Math.ceil(totalProducts / pageSize),
    currentPage: pageNumber,
  });
});

// @desc    Get product by slug
// @route   GET /api/admin/products/:slug
// @access  Private/Admin
export const getProductBySlugBYAdmin = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });
  }

  res.json({
    ...product.toObject(),
    images: generateFullImageUrls(req, product.images),
    colors: generateFullColorData(req, product.colors), // <-- Add this line
  });
});
// @desc    Delete product by slug
// @route   DELETE /api/admin/products/:slug
// @access  Private/Admin
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOneAndDelete({ slug: req.params.slug });

  if (!product) {
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });
  }

  res.json({ success: true, message: "Product deleted successfully." });
});
// @desc    Bulk delete products
// @route   POST /api/admin/products/bulk-delete
// @access  Private/Admin
export const bulkDeleteProducts = asyncHandler(async (req, res) => {
  const { slugs } = req.body; // Expecting an array of slugs

  if (!slugs || slugs.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No products selected for deletion." });
  }

  const deletedProducts = await Product.deleteMany({ slug: { $in: slugs } });

  if (deletedProducts.deletedCount === 0) {
    return res
      .status(404)
      .json({ success: false, message: "No products were deleted." });
  }

  res.json({
    success: true,
    message: `${deletedProducts.deletedCount} product(s) deleted successfully.`,
  });
});

// @desc    Create a new product
// @route   POST /api/admin/products
// @access  Private/Admin
export const createProductBYAdmin = asyncHandler(async (req, res) => {
  const {
    name,
    brand,
    description,
    price,
    discountPrice,
    category,
    fabric,
    tags = [],
    Trending,
    NewArrival,
    bestseller,
    weight,
    colors = [],
    countInStock,
    moreDetails,
    returnPolicy,
    howToCare,
    metaTitle,
    metaDescription,
    metaKeywords = [],
  } = req.body;

  // Defensive: ensure arrays
  const safeTags = Array.isArray(tags) ? tags : [];
  const safeColors = Array.isArray(colors) ? colors : [];
  const safeMetaKeywords = Array.isArray(metaKeywords) ? metaKeywords : [];

  // ✅ Slug generation
  const slug = slugify(name, { lower: true });
  const productExists = await Product.findOne({ slug });
  if (productExists) {
    return res.status(400).json({
      success: false,
      message: "Product with this name already exists.",
    });
  }

  // ✅ Validate colors and sizes
  const validSizes = ["S", "M", "L", "XL", "XXL"]; // <-- Add "S" here
  const allSKUs = [];
  let totalStock = 0;

  if (!Array.isArray(safeColors) || safeColors.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one color with sizes is required.",
    });
  }

  for (const color of safeColors) {
    // Defensive: ensure images is always an array
    color.images = Array.isArray(color.images)
      ? color.images
      : color.images
      ? [color.images]
      : [];

    if (!color.name || !color.icon || !color.images || !color.sizes) {
      return res.status(400).json({
        success: false,
        message: "Each color must have name, icon, images, and sizes.",
      });
    }

    // Defensive: ensure sizes is an object
    color.sizes =
      typeof color.sizes === "object" && color.sizes !== null
        ? color.sizes
        : {};

    for (const [size, details] of Object.entries(color.sizes)) {
      if (!validSizes.includes(size)) {
        return res
          .status(400)
          .json({ success: false, message: `Invalid size key "${size}".` });
      }

      if (!details?.sku || details.quantity == null) {
        return res.status(400).json({
          success: false,
          message: `Size "${size}" in color "${color.name}" must have both SKU and quantity.`,
        });
      }

      allSKUs.push(details.sku);
      totalStock += details.quantity;
    }
  }

  // ✅ SKU Uniqueness Check
  const duplicateSKU = await Product.findOne({
    "colors.sizes.sku": { $in: allSKUs },
  });

  if (duplicateSKU) {
    return res.status(400).json({
      success: false,
      message: "Duplicate SKU found in another product.",
    });
  }

  const product = await Product.create({
    name,
    slug,
    brand,
    description,
    price,
    discount: discountPrice ? { price: discountPrice } : undefined,
    category,
    tags: safeTags,
    weight,
    colors: safeColors,
    moreDetails,
    returnPolicy,
    howToCare,
    // NEW FIELDS:
    metaTitle,
    metaDescription,
    metaKeywords: safeMetaKeywords,
    bestseller,
    fabric, // <-- Add fabric here
  });

  res.status(201).json({ success: true, product });
});

// @desc    Update product by slug
// @route   PUT /api/admin/products/:slug
// @access  Private/Admin
export const updateProductBYAdmin = asyncHandler(async (req, res) => {
  const validSizes = ["S", "M", "L", "XL", "XXL"]; // <-- Add "S" here
  let allSKUs = [];
  let totalStock = 0;

  const { slug } = req.params;
  const product = await Product.findOne({ slug });

  if (!product) {
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });
  }

  const update = { ...req.body };

  // Parse metaKeywords if it's a string (e.g., from a form)
  if (update.metaKeywords && typeof update.metaKeywords === "string") {
    update.metaKeywords = update.metaKeywords.split(",").map((k) => k.trim());
  }

  // Ensure bestseller is boolean if present
  if (typeof update.bestseller === "string") {
    update.bestseller = update.bestseller === "true";
  }

  // Parse colors if present and not already an array
  if (update.colors) {
    // If colors is a string, parse it as JSON array
    if (typeof update.colors === "string") {
      update.colors = JSON.parse(update.colors);
    }
    // If colors is an object with numeric keys (from FormData), convert to array
    if (!Array.isArray(update.colors)) {
      update.colors = Object.values(update.colors);
    }
    // Parse sizes for each color if needed
    update.colors = update.colors.map((color) => ({
      ...color,
      sizes:
        typeof color.sizes === "string" ? JSON.parse(color.sizes) : color.sizes,
      images: Array.isArray(color.images)
        ? color.images
        : color.images
        ? [color.images]
        : [],
    }));
  }

  // ✅ Handle slug update if name changed
  if (update.name && update.name !== product.name) {
    const newSlug = slugify(update.name, { lower: true });
    const slugExists = await Product.findOne({ slug: newSlug });
    if (slugExists) {
      return res.status(400).json({
        success: false,
        message: "Product with this name already exists.",
      });
    }
    update.slug = newSlug;
  }

  // ✅ Validate images
  if (update.newImages) {
    update.images = [...new Set([...product.images, ...update.newImages])];
  }
  if (update.deleteImages) {
    update.images = (update.images || product.images).filter(
      (img) => !update.deleteImages.includes(img)
    );
  }

  // ✅ Validate colors & SKUs
  if (update.colors) {
    if (!Array.isArray(update.colors) || update.colors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one color with sizes is required.",
      });
    }

    for (const color of update.colors) {
      if (!color.name || !color.icon || !color.images || !color.sizes) {
        return res.status(400).json({
          success: false,
          message: "Each color must have name, icon, images, and sizes.",
        });
      }

      for (const [size, details] of Object.entries(color.sizes)) {
        if (!validSizes.includes(size)) {
          return res
            .status(400)
            .json({ success: false, message: `Invalid size key "${size}".` });
        }

        if (!details?.sku || details.quantity == null) {
          return res.status(400).json({
            success: false,
            message: `Size "${size}" in color "${color.name}" must have both SKU and quantity.`,
          });
        }

        allSKUs.push(details.sku);
        totalStock += details.quantity;
      }
    }

    // Check for duplicate SKUs (ignore current product)
    const duplicateSKU = await Product.findOne({
      slug: { $ne: slug },
      "colors.sizes.sku": { $in: allSKUs },
    });

    if (duplicateSKU) {
      return res.status(400).json({
        success: false,
        message: "Duplicate SKU found in another product.",
      });
    }

    update.countInStock = totalStock;
  }

  // Add fabric to update if present
  if (typeof update.fabric !== "undefined") {
    update.fabric = update.fabric;
  }

  const updatedProduct = await Product.findOneAndUpdate(
    { slug },
    { $set: update },
    {
      new: true,
      runValidators: true,
    }
  );

  const io = getIoInstance();
  io.emit("productUpdated", updatedProduct);

  res.json({ success: true, product: updatedProduct });
});

// @desc    Get tag suggestions for search
// @route   GET /api/tags/suggestions?query=searchTerm
export const getTagSuggestions = asyncHandler(async (req, res) => {
  const query = req.query.query?.trim();
  if (!query) return res.json([]);

  // Aggregate all tags from products
  const products = await Product.find({
    tags: { $exists: true, $ne: [] },
  }).select("tags");
  const allTags = products.flatMap((p) => p.tags).filter(Boolean);

  // Get unique tags
  const uniqueTags = Array.from(new Set(allTags));

  // Filter tags by query (case-insensitive, partial match)
  const filteredTags = uniqueTags.filter((tag) =>
    tag.toLowerCase().includes(query.toLowerCase())
  );

  // Limit to 8 suggestions
  res.json(filteredTags.slice(0, 8));
});
