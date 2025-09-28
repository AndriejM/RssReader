package pl.andriejsoft.rssreader.repository.data;

import io.mongock.api.annotations.ChangeUnit;
import io.mongock.api.annotations.Execution;
import io.mongock.api.annotations.RollbackExecution;
import pl.andriejsoft.rssreader.document.User;
import pl.andriejsoft.rssreader.repository.UserRepository;

@ChangeUnit(id = "createDefaultUser", order = "001", author = "mongock")
public class CreateDefaultUser {

    private final UserRepository userRepository;

    public CreateDefaultUser(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Execution
    public void changeSet() {
        userRepository.save(User.builder()
                .userName("DEFAULT")
                .build());
    }

    @RollbackExecution
    public void rollback() {
    }
}
