<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Routes
    |--------------------------------------------------------------------------
    |
    | The JSON endpoints the report UI talks to: list, create, view, update,
    | delete, clone and run saved reports. Point `middleware` at whatever
    | authenticates people in your app; every endpoint requires a user.
    |
    */

    'routes' => [
        'enabled' => true,
        'prefix' => 'datawell/reports',
        'middleware' => ['web', 'auth'],
    ],

    /*
    |--------------------------------------------------------------------------
    | Chart types
    |--------------------------------------------------------------------------
    |
    | The presentation vocabulary a report may be saved with. The published
    | <ReportChart> component renders each of these; add to the list only
    | after teaching the component the new type.
    |
    */

    'chart_types' => ['bar', 'barHorizontal', 'line', 'area', 'pie', 'number', 'table'],

];
