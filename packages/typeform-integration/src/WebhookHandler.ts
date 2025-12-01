import { TypeformClient, TypeformResponse } from './TypeformClient';
import { ApplicationService } from './ApplicationService';
import { UserApplication } from '@noderr/types';

/**
 * Handler for Typeform webhook events
 */
export class WebhookHandler {
  constructor(
    private typeformClient: TypeformClient,
    private applicationService: ApplicationService
  ) {}

  /**
   * Handle incoming webhook payload
   */
  async handleWebhook(payload: WebhookPayload): Promise<UserApplication> {
    // Check if application already exists
    const existing = await this.applicationService.getApplicationByTypeformId(
      payload.form_response.token
    );

    if (existing) {
      console.log(`Application already exists for response ${payload.form_response.token}`);
      return existing;
    }

    // Parse the response
    const typeformResponse: TypeformResponse = {
      response_id: payload.form_response.token,
      landed_at: payload.form_response.landed_at,
      submitted_at: payload.form_response.submitted_at,
      calculated: payload.form_response.calculated,
      answers: payload.form_response.answers
    };

    const application = this.typeformClient.parseResponse(typeformResponse);

    // Create application in database
    const created = await this.applicationService.createApplication(application);

    console.log(`Created application ${created.id} for ${created.email}`);

    // TODO: Send notification email to applicant
    // TODO: Send notification to admin panel

    return created;
  }

  /**
   * Validate webhook payload
   */
  validatePayload(payload: any): payload is WebhookPayload {
    return (
      payload &&
      payload.event_type === 'form_response' &&
      payload.form_response &&
      payload.form_response.token &&
      payload.form_response.submitted_at &&
      Array.isArray(payload.form_response.answers)
    );
  }
}

export interface WebhookPayload {
  event_id: string;
  event_type: 'form_response';
  form_response: {
    form_id: string;
    token: string;
    landed_at: string;
    submitted_at: string;
    calculated?: {
      score: number;
    };
    definition: {
      id: string;
      title: string;
      fields: any[];
    };
    answers: Array<{
      field: {
        id: string;
        ref: string;
        type: string;
      };
      type: string;
      text?: string;
      email?: string;
      number?: number;
      boolean?: boolean;
      choice?: {
        label: string;
        other?: string;
      };
      choices?: {
        labels: string[];
      };
    }>;
  };
}
