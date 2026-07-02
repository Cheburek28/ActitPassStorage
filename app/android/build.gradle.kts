allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}
subprojects {
    fun forceCompileSdk36() {
        extensions.findByName("android")?.let { androidExtension ->
            androidExtension.javaClass.methods
                .firstOrNull { method ->
                    method.name == "setCompileSdk" && method.parameterTypes.size == 1
                }
                ?.invoke(androidExtension, 36)
        }
    }
    plugins.withId("com.android.application") {
        forceCompileSdk36()
    }
    plugins.withId("com.android.library") {
        forceCompileSdk36()
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
