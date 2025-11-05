import mongoose from "mongoose";

const blogSchema = new mongoose.Schema({
  title: String,
  slug: { type: String, unique: true },
  image: String,
  summary: String,
  content: String,
  author: String,
  date: Date,
});

const Blog = mongoose.model("Blog", blogSchema);

export default Blog;