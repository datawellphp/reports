<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('datawell_reports', function (Blueprint $table): void {
            $table->id();
            $table->morphs('owner');
            $table->string('title', 150);
            $table->text('description')->nullable();
            $table->string('source');
            $table->json('request');
            $table->json('chart');
            $table->boolean('shared')->default(false);
            $table->timestamps();

            $table->index(['shared', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('datawell_reports');
    }
};
