# Documentación de Respuesta de la API

## Endpoint
```
GET https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search
```

## Estructura de Respuesta

### ApiOrderResponse (Respuesta Principal)

```typescript
{
  StatusCode: number;        // Código HTTP (ej: 200)
  Code: string;             // Código de respuesta (ej: "SUCCESS_SEARCH")
  Message: string;          // Mensaje descriptivo (ej: "Success search.")
  Mark: string;             // Identificador único de la petición
  LogId: string | null;     // ID de log (puede ser null)
  IsError: boolean;         // Indica si hay error
  Errors: any[];            // Array de errores (vacío si no hay)
  Warnings: any[];          // Array de advertencias (vacío si no hay)
  Meta: {
    Server: {
      Date: string;         // Fecha del servidor (ej: "2026-02-04")
      Time: string;        // Hora del servidor (ej: "17:11:25.599")
      DateOffSet: string;  // Offset de fecha (ej: "-05:00")
      TimeZone: string;     // Zona horaria (ej: "America/New_York")
      TimeZoneAbbr: string; // Abreviación (ej: "EST")
    }
  };
  Count: number;            // Número total de órdenes encontradas
  Data: ApiOrder[];         // Array de órdenes
}
```

### ApiOrder (Estructura de Cada Orden)

#### Campos Principales

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `Id` | string | UUID único de la orden | `"0755d9d0-5d24-4601-8aa9-ea6b641d1a98"` |
| `ShortId` | string | ID corto de la orden | `"ea527050"` |
| `BusinessKindCode` | number | Código de tipo de negocio | `300` |
| `SaleOrderId` | string \| null | ID de orden de venta | `null` |
| `DriverRouteId` | string \| null | ID de ruta del conductor | `null` |
| `PickupAt` | string | Fecha/hora de recogida (ISO 8601) | `"2026-02-04T10:45:00.000-05:00"` |
| `DeliveryAt` | string | Fecha/hora de entrega (ISO 8601) | `"2026-02-04T11:30:00.000-05:00"` |
| `DeliveryZoneId` | string | UUID de la zona de entrega | `"5bd51bfe-0f05-43ad-91ca-c33e4bbffe67"` |
| `OriginId` | string | UUID del origen | `"56534d39-0758-43c9-8a25-751b32972b0a"` |
| `DestinationId` | string | UUID del destino | `"0e4ea690-ec01-4472-8f7c-3ed6f9d06659"` |
| `UserId` | string | UUID del usuario/conductor asignado | `"581b9feb-5aaf-47d6-beaf-c472b528debf"` |
| `UserIdAt` | string | Fecha/hora de asignación de usuario | `"2026-02-04T09:19:48.383-05:00"` |
| `StatusSequence` | number | Secuencia del estado | `7` |
| `StatusCode` | number | Código numérico del estado | `400` |
| `StatusDescription` | string | Descripción del estado | `"Finished"`, `"En Route to Customer"`, `"Delivery Scheduled"` |
| `RoutePriority` | number | Prioridad de la ruta | `0` |
| `Latitude` | string | Latitud del destino | `"25.8672637"` |
| `Longitude` | string | Longitud del destino | `"-80.30736680000001"` |
| `Comment` | string | Comentarios adicionales | `"suite 115"` |
| `Tag` | string | Tags separados por comas | `"#AIA#,#EZCater#,#DISPATCHER_FIXED_FEE#"` |
| `CanceledBy` | string \| null | Usuario que canceló | `null` |
| `CanceledAt` | string \| null | Fecha/hora de cancelación | `null` |
| `CreatedBy` | string | Usuario que creó la orden | `"ForeignSystem12"` |
| `CreatedAt` | string | Fecha/hora de creación | `"2026-02-04T06:01:40.919-08:00"` |
| `UpdatedBy` | string | Usuario que actualizó | `"dispatcher16"` |
| `UpdatedAt` | string | Fecha/hora de última actualización | `"2026-02-04T08:25:04.821-08:00"` |
| `DisabledBy` | string \| null | Usuario que deshabilitó | `null` |
| `DisabledAt` | string \| null | Fecha/hora de deshabilitación | `null` |

#### Objeto Business

```typescript
Business: {
  Ticket: string;  // Código del ticket (formato: XXX-XXX, ej: "P5V-AK6")
  Fixed?: {
    Tip?: number;                    // Propina
    Amount?: number;                  // Monto total
    Distance?: number;                // Distancia en millas
    FeeDriver?: number;               // Tarifa del conductor
    FeeOutTown?: number;              // Tarifa fuera de ciudad
    EstimatedBy?: string;             // Quien estimó (ej: "DISPATCHER02")
    Compensation?: number;            // Compensación
    FeeDriverBase?: number;           // Tarifa base del conductor
    MinimumEarning?: number;          // Ganancia mínima
    ExtraMilesOrder?: number;         // Millas extra de la orden
    EstimatedEarning?: number;        // Ganancia estimada
    ExtraMilesDriver?: number;        // Millas extra del conductor
    FeeDriverOutTown?: number;        // Tarifa fuera de ciudad del conductor
    FeeEstablishment?: number;        // Tarifa del establecimiento
    ExtraMilesDriverAmount?: number;  // Monto de millas extra del conductor
  };
  EMailId?: string[];                // IDs de emails
  ORDER_IS_READY_TO_PICKUP?: {
    CreatedAt: string;               // Fecha/hora de creación
    CreatedBy: string;                // Usuario que creó
  };
}
```

#### Objetos Anidados Adicionales

##### bizOrigin (Origen)
```typescript
bizOrigin?: {
  Id: string;
  UserId: string | null;
  EstablishmentId: string;
  Address: string;                    // Dirección completa
  FormattedAddress: string;           // Dirección formateada
  Latitude: string;
  Longitude: string;
  Name: string;                       // Nombre del establecimiento
  EMail: string | null;
  Phone: string | null;
  Tag: string | null;
  Business: any;
}
```

##### bizDestination (Destino)
```typescript
bizDestination?: {
  Id: string;
  UserId: string | null;
  EstablishmentId: string | null;
  Address: string;
  FormattedAddress: string;
  Latitude: string;
  Longitude: string;
  Name: string;                       // Nombre del destinatario
  EMail: string | null;
  Phone: string | null;
  Tag: string | null;
  Business?: {
    Finish?: {
      Distance?: {
        Tag: string;
        DistanceText: string;          // Ej: "13.6 mi"
        DistanceUnit: string;         // Ej: "imperial"
        DurationText: string;         // Ej: "26 mins"
        DistanceMeter: number;        // Distancia en metros
        DurationSecond: number;       // Duración en segundos
        Origin?: any;
        Destination?: any;
        CreatedAt: string;
        CreatedBy: string;
      };
    };
    Distance?: Array<{
      Tag: string;
      Index: number;
      DistanceText: string;
      DistanceUnit: string;
      DurationText: string;
      DistanceMeter: number;
      DurationSecond: number;
      Origin: any;
      Destination: any;
      CreatedAt: string;
      CreatedBy: string;
    }>;
  };
}
```

##### bizDeliveryOrderStatusStep (Estado de la Orden)
```typescript
bizDeliveryOrderStatusStep?: {
  Id: string;
  BusinessKindCode: number;
  Sequence: number;
  First: number;
  Finish: number;
  Last: number;
  Canceled: number;
  Only: number;
  Code: number;                       // Código del estado
  Description: string;                // Descripción del estado
  BColor: string;                     // Color de fondo (hex)
  FColor: string;                     // Color de texto (hex)
  Icon: string | null;
  Tag: string;
  Business: any;
}
```

##### sysUser (Usuario/Conductor)
```typescript
sysUser?: {
  Id: string;
  ShortId: string;
  GroupId: string;
  Name: string;                       // Email del usuario
  Avatar: string;
  Role: string | null;
  PersonId: string;
  sysPerson?: {
    Id: string;
    ImageId: string;
    FirstName: string;
    LastName: string;
    EMail: string;
    Phone: string;
    Tag: string | null;
    Business: any;
  };
  Tag: string;
  Business: any;
}
```

##### Otros Campos Opcionales
- `bizEstablishment`: Información del establecimiento
- `bizDeliveryZone`: Información de la zona de entrega
- `bizEstablishmentServiceQuality`: Calidad de servicio del establecimiento
- `bizDriverServiceQuality`: Calidad de servicio del conductor
- `Payments`: Número de pagos
- `Images`: Número de imágenes
- `Issues`: Número de problemas
- `Status`: Estado numérico
- `Exported`: Array de números (IDs exportados)

## Valores Importantes

### StatusDescription (Valores Comunes)
- `"En Route to Customer"` - En ruta al cliente
- `"Delivery Scheduled"` - Entrega programada
- `"Finished"` - Completada
- `"Expired"` - Expirada

### Formato de Fechas
Todas las fechas están en formato ISO 8601 con timezone:
- `"2026-02-04T11:30:00.000-05:00"` (formato completo)
- Timezone: `-05:00` (EST) o `-08:00` (PST)

### Formato de Ticket
- Formato: `XXX-XXX` (ej: `"P5V-AK6"`)
- Se encuentra en: `Business.Ticket`
- Puede incluir `#` al inicio en algunos casos

## Ejemplo de Uso en el Código

```typescript
// Obtener órdenes de la API
const apiOrders = await getAllOrdersFromAPI(orderTickets);

// Procesar cada orden
for (const apiOrder of apiOrders) {
  // Extraer ticket
  const ticket = extractTicketFromApiResponse(apiOrder.Business?.Ticket);
  
  // Parsear fechas
  const deliveryAtDate = parseISODeliveryTime(apiOrder.DeliveryAt);
  const pickupAtDate = parseISODeliveryTime(apiOrder.PickupAt);
  
  // Obtener estado
  const status = mapApiStatusToDeliveryStatus(apiOrder);
  
  // Usar información adicional
  const originName = apiOrder.bizOrigin?.Name;
  const destinationName = apiOrder.bizDestination?.Name;
  const driverName = apiOrder.sysUser?.sysPerson?.FirstName + " " + apiOrder.sysUser?.sysPerson?.LastName;
}
```

## Notas Importantes

1. **DeliveryAt vs Page Time**: El campo `DeliveryAt` de la API puede diferir de la hora mostrada en la página. Se recomienda validar comparando ambos valores.

2. **Business.Ticket**: Este campo contiene el código del ticket que se usa para identificar la orden. Puede venir con o sin el prefijo `#`.

3. **StatusDescription**: Este campo es el más importante para determinar el estado de la orden. Los valores válidos para procesamiento son `"En Route to Customer"` y `"Delivery Scheduled"`.

4. **Campos Opcionales**: Muchos campos anidados son opcionales y pueden ser `null` o `undefined`. Siempre validar antes de usar.

5. **Timezone**: Las fechas pueden venir en diferentes timezones. El código convierte todo a EST para comparaciones.
