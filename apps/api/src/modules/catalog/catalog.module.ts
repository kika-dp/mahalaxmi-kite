import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';

@Module({
  imports: [InventoryModule],
  controllers: [CatalogController],
  providers: [ProductsService, CategoriesService],
  exports: [ProductsService],
})
export class CatalogModule {}
