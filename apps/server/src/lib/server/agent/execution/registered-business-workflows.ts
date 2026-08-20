import { BusinessWorkflowRegistry } from './business-workflow-registry';
import { genericHotelDataQueryWorkflow } from './workflows/generic-hotel-data-query-workflow';
import { hotelOperatingSummaryWorkflow } from './workflows/hotel-operating-summary-workflow';
import { publicHotelRatesWorkflow } from './workflows/public-hotel-rates-workflow';
import { weatherOperationsAdviceWorkflow } from './workflows/weather-operations-advice-workflow';

export function createBusinessWorkflowRegistry(): BusinessWorkflowRegistry {
	return new BusinessWorkflowRegistry([
		weatherOperationsAdviceWorkflow,
		hotelOperatingSummaryWorkflow,
		publicHotelRatesWorkflow,
		genericHotelDataQueryWorkflow
	]);
}
