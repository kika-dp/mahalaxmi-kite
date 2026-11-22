import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PdfService } from '../documents/pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesQueryService } from './invoices.query';
import { InvoicesService } from './invoices.service';
import { MeController } from './me.controller';

@Module({
  imports: [InventoryModule],
  controllers: [InvoicesController, MeController],
  providers: [InvoicesService, InvoicesQueryService, PdfService],
  exports: [InvoicesService, InvoicesQueryService, PdfService],
})
export class InvoicesModule {}
