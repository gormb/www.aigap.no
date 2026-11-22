#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "VignetteCharacter.generated.h"

class UCameraComponent;
class USpringArmComponent;

UCLASS()
class VIGNETTE_API AVignetteCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AVignetteCharacter();

protected:
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	void MoveForward(float Value);
	void MoveRight(float Value);
	void Turn(float Value);
	void LookUp(float Value);

	UPROPERTY(VisibleAnywhere, Category = "Camera")
	USpringArmComponent* CameraBoom;

	UPROPERTY(VisibleAnywhere, Category = "Camera")
	UCameraComponent* FollowCamera;
};
