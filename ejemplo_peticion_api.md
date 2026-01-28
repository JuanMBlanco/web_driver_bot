# Ejemplo de Petición API

## Petición 1: Obtener conteo de órdenes

### Método y URL
```
GET https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search/count?where=A.DeliveryAt%20%3D%20%272026-01-26%27%20AND%20E.Canceled%20%3D%200%20AND%20A.BusinessKindCode%20%3D%20300%20AND%20E.Canceled%20%3D%200%20AND%20%28A.ExtraData%20LIKE%20%27321-R4M%27%20OR%20A.ExtraData%20LIKE%20%27HH7-07V%27%20OR%20A.ExtraData%20LIKE%20%27K5A-3RR%27%29&offset=0&limit=200
```

### URL decodificada (más legible)
```
GET https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search/count?where=A.DeliveryAt = '2026-01-26' AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0 AND (A.ExtraData LIKE '321-R4M' OR A.ExtraData LIKE 'HH7-07V' OR A.ExtraData LIKE 'K5A-3RR')&offset=0&limit=200
```

### Headers
```
Content-Type: application/json
Authorization: p:f6797849-d5df-43c4-8349-2326875571e7
FrontendId: ccc1
TimeZoneId: America/Los_Angeles
Language: en_US
```

### Query Parameters
- `where`: `A.DeliveryAt = '2026-01-26' AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0 AND (A.ExtraData LIKE '321-R4M' OR A.ExtraData LIKE 'HH7-07V' OR A.ExtraData LIKE 'K5A-3RR')`
- `offset`: `0`
- `limit`: `200`

---

## Petición 2: Obtener órdenes (con paginación)

### Método y URL - Primera página
```
GET https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search?where=A.DeliveryAt%20%3D%20%272026-01-26%27%20AND%20E.Canceled%20%3D%200%20AND%20A.BusinessKindCode%20%3D%20300%20AND%20E.Canceled%20%3D%200%20AND%20%28A.ExtraData%20LIKE%20%27321-R4M%27%20OR%20A.ExtraData%20LIKE%20%27HH7-07V%27%20OR%20A.ExtraData%20LIKE%20%27K5A-3RR%27%29&offset=0&limit=200
```

### URL decodificada (más legible)
```
GET https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search?where=A.DeliveryAt = '2026-01-26' AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0 AND (A.ExtraData LIKE '321-R4M' OR A.ExtraData LIKE 'HH7-07V' OR A.ExtraData LIKE 'K5A-3RR')&offset=0&limit=200
```

### Headers
```
Content-Type: application/json
Authorization: p:f6797849-d5df-43c4-8349-2326875571e7
FrontendId: ccc1
TimeZoneId: America/Los_Angeles
Language: en_US
```

### Query Parameters - Primera página
- `where`: `A.DeliveryAt = '2026-01-26' AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0 AND (A.ExtraData LIKE '321-R4M' OR A.ExtraData LIKE 'HH7-07V' OR A.ExtraData LIKE 'K5A-3RR')`
- `offset`: `0`
- `limit`: `200`

### Query Parameters - Segunda página (si hay más de 200 resultados)
- `where`: `A.DeliveryAt = '2026-01-26' AND E.Canceled = 0 AND A.BusinessKindCode = 300 AND E.Canceled = 0 AND (A.ExtraData LIKE '321-R4M' OR A.ExtraData LIKE 'HH7-07V' OR A.ExtraData LIKE 'K5A-3RR')`
- `offset`: `200`
- `limit`: `200`

---

## Ejemplo con cURL

### Petición de conteo
```bash
curl -X GET \
  'https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search/count?where=A.DeliveryAt%20%3D%20%272026-01-26%27%20AND%20E.Canceled%20%3D%200%20AND%20A.BusinessKindCode%20%3D%20300%20AND%20E.Canceled%20%3D%200%20AND%20%28A.ExtraData%20LIKE%20%27321-R4M%27%20OR%20A.ExtraData%20LIKE%20%27HH7-07V%27%20OR%20A.ExtraData%20LIKE%20%27K5A-3RR%27%29&offset=0&limit=200' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: p:f6797849-d5df-43c4-8349-2326875571e7' \
  -H 'FrontendId: ccc1' \
  -H 'TimeZoneId: America/Los_Angeles' \
  -H 'Language: en_US'
```

### Petición de búsqueda
```bash
curl -X GET \
  'https://kk-usa-fl-prod01-odin-v2-op.odindt.com/api/v1/business/dev007/dispatcher/delivery/order/search?where=A.DeliveryAt%20%3D%20%272026-01-26%27%20AND%20E.Canceled%20%3D%200%20AND%20A.BusinessKindCode%20%3D%20300%20AND%20E.Canceled%20%3D%200%20AND%20%28A.ExtraData%20LIKE%20%27321-R4M%27%20OR%20A.ExtraData%20LIKE%20%27HH7-07V%27%20OR%20A.ExtraData%20LIKE%20%27K5A-3RR%27%29&offset=0&limit=200' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: p:f6797849-d5df-43c4-8349-2326875571e7' \
  -H 'FrontendId: ccc1' \
  -H 'TimeZoneId: America/Los_Angeles' \
  -H 'Language: en_US'
```

---

## Notas importantes

1. **Fecha dinámica**: La fecha `'2026-01-26'` se genera automáticamente usando la fecha de hoy en formato YYYY-MM-DD (zona horaria EST).

2. **Tickets detectados**: Los códigos de tickets (ej: `321-R4M`, `HH7-07V`, `K5A-3RR`) se detectan automáticamente desde la página DOM antes de hacer la petición.

3. **Paginación**: Si hay más de 200 resultados, se realizan peticiones adicionales incrementando el `offset` (0, 200, 400, etc.) hasta obtener todos los resultados.

4. **WHERE clause**: 
   - `A.DeliveryAt = '2026-01-26'` - Filtra por fecha de entrega de hoy
   - `E.Canceled = 0` - Excluye órdenes canceladas (aparece dos veces como especificado)
   - `A.BusinessKindCode = 300` - Filtra por tipo de negocio
   - `A.ExtraData LIKE 'ticket'` - Filtra por cada ticket detectado (se repite con OR para cada ticket)
