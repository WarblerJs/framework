import { describe, expect, test } from "bun:test";
import {
  columnNameToFieldName,
  deriveColumnName,
  deriveTableName,
  tableNameToClientKey,
  tableNameToModelName,
} from "../src/naming";

describe("naming", () => {
  test("deriveTableName pluralizes a singular scaffold argument", () => {
    expect(deriveTableName("user")).toBe("users");
    expect(deriveTableName("category")).toBe("categories");
    expect(deriveTableName("box")).toBe("boxes");
    expect(deriveTableName("userRole")).toBe("user_roles");
  });

  test("deriveColumnName snake_cases a field name", () => {
    expect(deriveColumnName("passwordHash")).toBe("password_hash");
  });

  test("tableNameToModelName singularizes and PascalCases a table name", () => {
    expect(tableNameToModelName("users")).toBe("User");
    expect(tableNameToModelName("categories")).toBe("Category");
    expect(tableNameToModelName("boxes")).toBe("Box");
    expect(tableNameToModelName("user_roles")).toBe("UserRole");
  });

  test("tableNameToModelName consults the modelNames override first", () => {
    expect(tableNameToModelName("people", { people: "Person" })).toBe("Person");
    expect(tableNameToModelName("people")).not.toBe("Person");
  });

  test("tableNameToClientKey lowercases the first letter of the derived model name", () => {
    expect(tableNameToClientKey("users")).toBe("user");
    expect(tableNameToClientKey("people", { people: "Person" })).toBe("person");
  });

  test("columnNameToFieldName camelCases a snake_case column name", () => {
    expect(columnNameToFieldName("password_hash")).toBe("passwordHash");
    expect(columnNameToFieldName("id")).toBe("id");
  });

  test("round-trips through both directions for regular words", () => {
    expect(tableNameToModelName(deriveTableName("post"))).toBe("Post");
    expect(columnNameToFieldName(deriveColumnName("createdAt"))).toBe("createdAt");
  });
});
