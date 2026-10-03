/** Import the source text verbatim at build time, without a generated copy. */
module.exports = function rawTextLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
