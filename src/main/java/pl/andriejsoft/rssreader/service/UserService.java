package pl.andriejsoft.rssreader.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.entity.UserEntity;
import pl.andriejsoft.rssreader.repository.UserRepository;

import java.util.List;
import java.util.Optional;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    public List<UserEntity> findAll() {
        return (List<UserEntity>) userRepository.findAll();
    }

    public Optional<UserEntity> findById(Long id) {
        return userRepository.findById(id);
    }

    public UserEntity save(UserEntity UserEntity) {
        return userRepository.save(UserEntity);
    }

    public void deleteById(Long id) {
        userRepository.deleteById(id);
    }
}
