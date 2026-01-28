/**
 * GraphQL queries for fetching product and variant data
 * for label export
 */

export const PRODUCTS_QUERY = `#graphql
  query GetProductsWithVariants($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          status
          vendor
          featuredImage {
            url
            altText
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                inventoryQuantity
                displayName
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Query to check if a barcode already exists in the store
 */
export const CHECK_BARCODE_EXISTS_QUERY = `#graphql
  query CheckBarcodeExists($query: String!) {
    products(first: 1, query: $query) {
      edges {
        node {
          id
          variants(first: 1) {
            edges {
              node {
                id
                barcode
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Mutation to update a product variant's barcode
 */
export const UPDATE_VARIANT_BARCODE_MUTATION = `#graphql
  mutation UpdateVariantBarcode($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        barcode
        sku
        displayName
      }
      userErrors {
        field
        message
      }
    }
  }
`;
