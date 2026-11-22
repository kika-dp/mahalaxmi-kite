import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

export function snakeCase(s: string): string {
  return s
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1_$2')
    .toLowerCase();
}

/** camelCase properties ↔ snake_case columns. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]): string {
    return customName ?? snakeCase([...prefixes, propertyName].join('_'));
  }
  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }
}
