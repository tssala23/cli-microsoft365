import { Event } from '@microsoft/microsoft-graph-types';
import { z } from 'zod';
import { globalOptionsZod } from '../../../../Command.js';
import GraphCommand from '../../../base/GraphCommand.js';
import { Logger } from '../../../../cli/Logger.js';
import commands from '../../commands.js';
import { validation } from '../../../../utils/validation.js';
import { odata } from '../../../../utils/odata.js';
import { CliRequestOptions } from '../../../../request.js';
import { calendar } from '../../../../utils/calendar.js';

export const options = z.strictObject({
  ...globalOptionsZod.shape,
  userId: z.string().refine(id => validation.isValidGuid(id), {
    error: e => `'${e.input}' is not a valid GUID.`
  }).optional(),
  userName: z.string().refine(name => validation.isValidUserPrincipalName(name), {
    error: e => `'${e.input}' is not a valid UPN.`
  }).optional(),
  calendarId: z.string().optional(),
  calendarName: z.string().optional(),
  startDateTime: z.string().refine(date => validation.isValidISODateTime(date), {
    error: e => `'${e.input}' is not a valid ISO date-time.`
  }).optional(),
  endDateTime: z.string().refine(date => validation.isValidISODateTime(date), {
    error: e => `'${e.input}' is not a valid ISO date-time.`
  }).optional(),
  timeZone: z.string().optional(),
  properties: z.string().optional(),
  filter: z.string().optional()
});

declare type Options = z.infer<typeof options>;

interface CommandArgs {
  options: Options;
}

class OutlookEventListCommand extends GraphCommand {
  public get name(): string {
    return commands.EVENT_LIST;
  }

  public get description(): string {
    return 'Retrieves a list of events from a specific calendar of a user.';
  }

  public get schema(): z.ZodType | undefined {
    return options;
  }

  public getRefinedSchema(schema: typeof options): z.ZodObject<any> | undefined {
    return schema
      .refine(options => [options.userId, options.userName].filter(x => x !== undefined).length <= 1, {
        error: 'Specify either userId or userName, but not both'
      })
      .refine(options => !(options.calendarId && options.calendarName), {
        error: 'Specify either calendarId or calendarName, but not both.'
      });
  }

  public defaultProperties(): string[] | undefined {
    return ['id', 'subject'];
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    try {
      if (this.verbose) {
        await logger.logToStderr('Getting a list of the events...');
      }

      let events;
      const endpoint = await this.getRequestUrl(args.options);
      if (args.options.timeZone) {
        const requestOptions: CliRequestOptions = {
          url: endpoint,
          headers: {
            accept: 'application/json;odata.metadata=none',
            Prefer: `outlook.timezone="${args.options.timeZone}"`
          },
          responseType: 'json'
        };

        events = await odata.getAllItems<Event>(requestOptions);
      }
      else {
        events = await odata.getAllItems<Event>(endpoint);
      }

      await logger.log(events);
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }

  private async getRequestUrl(options: Options): Promise<string> {
    const queryParameters: string[] = [];

    if (options.properties) {
      const allProperties = options.properties.split(',');
      const selectProperties = allProperties.filter(prop => !prop.includes('/'));
      const expandProperties = allProperties.filter(prop => prop.includes('/'));

      if (selectProperties.length > 0) {
        queryParameters.push(`$select=${selectProperties}`);
      }

      if (expandProperties.length > 0) {
        const fieldExpands = expandProperties.map(p => `${p.split('/')[0]}($select=${p.split('/')[1]})`);
        queryParameters.push(`$expand=${fieldExpands.join(',')}`);
      }
    }

    if (options.filter || options.startDateTime || options.endDateTime) {
      let filter = options.filter || '';
      if (options.startDateTime) {
        filter += `${filter ? ' and ' : ''}start/dateTime ge '${options.startDateTime}'`;
      }
      if (options.endDateTime) {
        filter += `${filter ? ' and ' : ''}start/dateTime lt '${options.endDateTime}'`;
      }
      queryParameters.push(`$filter=${filter}`);
    }

    const queryString = queryParameters.length > 0
      ? `?${queryParameters.join('&')}`
      : '';

    const userIdentifier = options.userId ?? options.userName;
    let calendarId = options.calendarId;
    if (options.calendarName) {
      calendarId = (await calendar.getUserCalendarByName(userIdentifier, options.calendarName))!.id;
    }
    const userPath = userIdentifier
      ? `users('${userIdentifier}')`
      : 'me';
    return calendarId
      ? `${this.resource}/v1.0/${userPath}/calendars/${calendarId}/events${queryString}`
      : `${this.resource}/v1.0/${userPath}/events${queryString}`;
  }
}

export default new OutlookEventListCommand();
