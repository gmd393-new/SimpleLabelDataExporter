/**
 * GraphQL queries for fetching product and variant data
 * for Niimbot label export
 */

export const PRODUCTS_QUERY = `#graphql
  query GetProductsWithVariants($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
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
